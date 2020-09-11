# Vue2 响应式原理

当前笔记为`2.6.11`版本的 Vue

很多人对 Vue 的响应式原理大概能说得出，但是完整深入的流程可能不太清晰，其实中间还是有很多有趣的部分，下面将会从初始化开始讲起整个响应式系统的原理。部分代码片段中会有些个人理解所加的注解，注意留意一下。

## 1. 开始

先从[vue/src/core/instance/index.js](https://github.com/vuejs/vue/blob/v2.6.11/src/core/instance/index.js)进入，这里是 Vue 的构造函数，下面调用了[initMixin](https://github.com/vuejs/vue/blob/v2.6.11/src/core/instance/init.js)，让我们进入去看看。

### initState

这里会给 Vue 的 prototype 注入`\_init`方法，并且在实例化（`new Vue`）或创建组件（`Vue.extend`）时调用它。在这里，可以看到 Vue 在`beforeCreate`和`created` 的时机究竟做了什么，这里先只讨论响应式原理，所以我们看到[initState](https://github.com/vuejs/vue/blob/v2.6.11/src/core/instance/init.js#L57)方法被调用，然后进入[state.js](https://github.com/vuejs/vue/blob/v2.6.11/src/core/instance/state.js#L48)

```javascript
// 初始化state，这里初始化了props、methods、data、computed、watch
export function initState(vm: Component) {
  vm._watchers = [];
  const opts = vm.$options;
  if (opts.props) initProps(vm, opts.props); // 初始化props
  if (opts.methods) initMethods(vm, opts.methods); // 初始化methods
  if (opts.data) {
    initData(vm); // 初始化data
  } else {
    observe((vm._data = {}), true /* asRootData */); // 如果没data则给_data赋空对象并映射给data
  }
  if (opts.computed) initComputed(vm, opts.computed); // 初始化computed
  // nativeWatch判断是因为firefox里Object.prototype中有watch属性
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch); // 初始化watch
  }
}
```

### initData

下面就是如何去初始化 data 的 initData 函数

```javascript
// 初始化data，这里要判断获取一次data和判断data是否与props和methods同名，然后要将data挂载到_data，并代理this.访问，然后观察属性
function initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === ‘function’ // 将配置中的data挂载到this._data
    ? getData(data, vm) // 如果data是个函数
    : data || {}
  if (!isPlainObject(data)) { // 如果得出的data不是个对象就警告
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)  // 代理this.属性访问指向this._data.属性内
    }
  }
  // observe data
  observe(data, true /* asRootData */)  // 开始观察对象
}

// 这方法是用来代理某个对象的属性访问指向到另一个对象上的
// 这里也是你能从this上直接获取到data内的属性的原理，其实是this.属性利用getter指向了this._data.属性上了，setter同理
export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}

// 获取方法型data时将null推入dep栈，不去触发data的getter依赖收集，后面会说为什么要用dep栈管理dep
export function getData (data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget() // 空入栈
  try {
    return data.call(vm, vm) // 获取方法型data
  } catch (e) {
    handleError(e, vm, `data()`)
    return {}
  } finally {
    popTarget() // 出栈
  }
}
```

这里从上往下做了几件事

1. 首先将配置中的 data 交给实例上的\_data，如果是函数则执行，执行途中会将空推入 dep 栈中（后面会解释为什么要用栈），目的是防止 data 有已被观察的对象并触发了依赖收集，毕竟这里只是去一次 data 值。
2. 判断如果配置 data 为非对象，或者对象内属性名与 props 和 methods 的字段名有冲突则报警告。
3. 将\_data 上的属性代理到实例对象内，即平时用的`this.属性`其实访问的是`this._data.属性`。
4. 开始观察 data，并且加个 root 标志，意思是这被观察的对象为顶级 data 下的，毕竟后面 observe 还会递归使用。

## 2. 观察者（Observer）

### obseve

开始观察属性调用了 observe 方法，我们进入到[vue/src/core/observer/index.js](https://github.com/vuejs/vue/blob/v2.6.11/src/core/observer/index.js)内

```javascript
/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
// asRootData是根对象标识，调用observe的要么是跟对象要么是根对象下面的属性递归时
export function observe(value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return;
  }
  let ob: Observer | void;
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    // 如果对象上有__ob__则使用__ob__属性
    ob = value.__ob__;
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value);
  }
  if (asRootData && ob) {
    // 如果是根部对象，即非对象内属性，则计数一下依赖到这个对象的组件实例
    ob.vmCount++;
  }
  return ob;
}
```

可以看到 observe 方法其实主要做的就是实例化 Observer 类，而 Observer 就是 Vue 响应式的核心之一了，我这里称之为`观察者`,因为是用来观察数据变化的。

### Observer

```javascript
/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor(value: any) {
    this.value = value;
    this.dep = new Dep(); // 在实例上挂载订阅器，这个订阅器是对象本身的订阅器，用于收集对象更改、移除、数组变化
    this.vmCount = 0;
    def(value, '__ob__', this); // 在对象上将自己挂载于__ob__下
    if (Array.isArray(value)) {
      if (hasProto) {
        // 这里将会劫持array原型链上的方法，使其可以响应式
        protoAugment(value, arrayMethods);
      } else {
        copyAugment(value, arrayMethods, arrayKeys);
      }
      /**
       * 遍历数组，但是并没有劫持数组下标，仅仅只是对数组内所有值都走一次observe方法，这里其实完全可以劫持,
       * 没这么做是因为这样子得不偿失，数组长度可能整天变动，性能会比较低下，所以选择劫持数组更改的方法（splice）等
       */
      this.observeArray(value);
    } else {
      this.walk(value); // 遍历并劫持对象中的所有属性
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk(obj: Object) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[I]); // 劫持对象中所有属性值
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray(items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[I]); // 数组里循环观察每个值
    }
  }
}
```

### defineReactive

defineReactive 就是如何劫持对象中属性的核心

```javascript
/**
 * Define a reactive property on an Object.
 */
export function defineReactive(
  obj: Object,
  key: string,
  val: any, // 这个其实也是属性值的闭包
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep(); // 属性订阅器，闭包内的，所以需要dep栈调取

  const property = Object.getOwnPropertyDescriptor(obj, key); // 获取对象属性本身描述符
  if (property && property.configurable === false) {
    return;
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get;
  const setter = property && property.set;
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key];
  }

  let childOb = !shallow && observe(val); // 获取值的观察者
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter() {
      // 这里就是最核心的getter，在获取属性值的时机收集依赖
      const value = getter ? getter.call(obj) : val;
      if (Dep.target) {
        dep.depend(); // 依赖收集（将当前的watcher加入dep依赖中）
        if (childOb) {
          childOb.dep.depend(); // 如果有子订阅器也收集本次watcher
          if (Array.isArray(value)) {
            dependArray(value);
          }
        }
      }
      return value;
    },
    set: function reactiveSetter(newVal) {
      // 这里就是最核心的setter，在设置属性值的时机通知依赖更新
      const value = getter ? getter.call(obj) : val;
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        // 这里是个有趣的点，自我对比主要是NaN不等于自己
        return;
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter();
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return;
      if (setter) {
        setter.call(obj, newVal);
      } else {
        val = newVal;
      }
      childOb = !shallow && observe(newVal); // 获取新的赋值的观察者
      dep.notify(); // 订阅器通知更新
    },
  });
}
```

看到这里或许会有几个疑惑点：

- Observer 类中初始化了一个`订阅器`，而 defineReactive 中也产生了个在闭包中的`订阅器`。其实`观察者`中的`订阅器`是对这个对象本身的赋值，数组变化的订阅；而闭包内的`订阅器`则是订阅对象内的属性的。
- (newVal !== newVal && value !== value)，这一句是为了判断 NaN，因为 NaN 不等于自身。

到这里，就已经做好了对数据的劫持了，即获取操作会让订阅器知道并收集依赖，设置操作会通知订阅器更新。

## 3. 订阅器（Dep）

Dep 我这里称之为`订阅器`，它的作用是做了`观察者`和`订阅者`直接通信的桥梁，在[vue/src/core/observer/dep.js](https://github.com/vuejs/vue/blob/v2.6.11/src/core/observer/dep.js)内。

`订阅器`内维护着一个对当前订阅了的`订阅者`列表，而该`订阅器`又被`观察者`持有着。所以：

- 当`观察者`被获取值的时候，当前 Dep.target 可能会挂载着一个`订阅者`，此时`订阅器`会将该`订阅者`收集起来，意义就是可以认为：当前`订阅者`执行更新行为（渲染或者获取值）的时候，触发了`观察者`获取值操作，所以该`订阅者`依赖这个`观察者`的更新。

- 当`观察者`被赋值时，`观察者`触发更新时会通知`订阅器`，`订阅器`会让所有挂载在自己身上的`订阅者`更新；而`订阅者`更新将会触发`观察者`取值，如此循环。

```javascript
import type Watcher from './watcher';
import { remove } from '../util/index';
import config from '../config';

let uid = 0;

/**
 * A dep is an observable that can have multiple
 * directives subscribing to it.
 */
export default class Dep {
  static target: ?Watcher; // 当前的订阅者
  id: number;
  subs: Array<Watcher>; // 订阅了这个订阅器的所有订阅者集合

  constructor() {
    this.id = uid++;
    this.subs = [];
  }

  // 添加订阅者
  addSub(sub: Watcher) {
    this.subs.push(sub);
  }

  // 移除订阅者
  removeSub(sub: Watcher) {
    remove(this.subs, sub);
  }

  // 依赖收集，将当前的订阅器递收集当前的订阅者
  depend() {
    if (Dep.target) {
      Dep.target.addDep(this);
    }
  }

  // 通知所有订阅器内订阅者们更新
  notify() {
    // stabilize the subscriber list first
    const subs = this.subs.slice();
    if (process.env.NODE_ENV !== 'production' && !config.async) {
      // subs aren't sorted in scheduler if not running async
      // we need to sort them now to make sure they fire in correct
      // order
      subs.sort((a, b) => a.id - b.id);
    }
    for (let i = 0, l = subs.length; i < l; i++) {
      subs[i].update();
    }
  }
}

// The current target watcher being evaluated.
// This is globally unique because only one watcher
// can be evaluated at a time.
Dep.target = null; // 因为js单线程、同步机制，同时只会有一个watcher在被处理
const targetStack = []; // Dep.target的栈

export function pushTarget(target: ?Watcher) {
  // 入栈
  targetStack.push(target);
  Dep.target = target;
}

export function popTarget() {
  // 出栈
  targetStack.pop();
  Dep.target = targetStack[targetStack.length - 1];
}
```

### Dep.target

这个是 Dep 类上的静态属性，就是说全局只有一个，也是当前被处理的`订阅者`Watcher 被挂载的地方。但是这里就有问题了，其实因为 js 单线程的原因，同时只有一个 Watcher 被处理，为什么需要有个 targetStack 即模拟出一个栈去管理呢？

#### 为什么需要用栈来管理 Dep.target

在 Vue1 中仅仅是依靠 Dep.target 里进行依赖收集和当前处理中的订阅器，因为 Vue1 视图更新采用的是细粒度绑定的方式，即可以理解为

```xml
<!-- root -->
<div>
  {{ a }}
  <my :text="b"></my>
  {{ c }}
</div>

<!-- component my -->
<span>{{ b }}</span>
```

会被解析成：

```javascript
watch(for a) -> directive(update {{ a }})
watch(for b) -> directive(update {{ b }})
watch(for c) -> directive(update {{ c }})
```

由于渲染是细粒度绑定，所以在处理完一个数据视图绑定后才回处理新的。

而在 Vue2 中，视图会被抽象成 render 函数，一个 render 函数只会生成一个 watcher，其机理会可以理解为：

```javascript
renderRoot () {
    ...
    renderMy ()
    ...
}
```

这里就包含了嵌套调用，只要有嵌套调用就会有调用栈，当调用 root 时当前 root watcher 入栈，执行到 my 渲染时，此时要中断 root 的 evaluate，而在 my 的 evaluate 结束后 root 将会继续执行，这就是 target 栈的意义

## 4.订阅者（Watcher）

Watcher 是数据变化后的行为的执行人，所以这里我称之为`订阅者`，在[vue/src/core/observer/watcher.js](https://github.com/vuejs/vue/blob/v2.6.11/src/core/observer/watcher.js)内。

在了解`订阅者`之前，需要知道 Vue 中 Watcher 有三种，分别是：

- **<u>自定义 Watcher</u>**：用户自己创建的 watch 或\$watch
- **<u>计算 Watcher</u>**：声明计算属性时自动创建的 Watcher
- **<u>渲染 Watcher</u>**：每个组件创建时都有个 Watcher

而内部执行顺序是 **<u>计算 Watcher</u>** &rarr; **<u>自定义 Watcher</u>** &rarr; **<u>渲染 Watcher</u>**

```javascript
import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop,
} from '../util/index';

import { traverse } from './traverse';
import { queueWatcher } from './scheduler';
import Dep, { pushTarget, popTarget } from './dep';

import type { SimpleSet } from '../util/index';

let uid = 0;

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component; // 组件实例
  expression: string; // 取值函数或者函数名，用于错误提示的
  cb: Function; // 更新后的回调函数（一般在自定义watcher才存在，其实就是watch的handler属性）
  id: number;
  deep: boolean;
  user: boolean; // 用于错误处理，只有自定义watcher为true
  lazy: boolean; // 惰性取值，在计算wathcer中为true
  sync: boolean;
  dirty: boolean; // 标记是否已被惰性求值，如果是就返回不调用get
  active: boolean;
  deps: Array<Dep>; // 当前依赖器表
  newDeps: Array<Dep>; // 即将到来的依赖器表
  depIds: SimpleSet; // 当前依赖器id表
  newDepIds: SimpleSet; // 即将到来的依赖器id表
  before: ?Function; // 用于队列取值前触发，只在渲染watcher中执行beforeUpdate事件发布
  getter: Function; // 取值函数，用于触发getter形成依赖收集闭环，自定义watcher里会变成属性取值函数或者$watch中的取值方法，计算watcher里为computed的getter，渲染watcher里为render函数，包含vnode创建和打补丁等
  value: any; // 值

  constructor(
    vm: Component,
    expOrFn: string | Function,
    cb: Function,
    options?: ?Object,
    isRenderWatcher?: boolean
  ) {
    this.vm = vm;
    if (isRenderWatcher) {
      vm._watcher = this;
    }
    vm._watchers.push(this);
    // options
    if (options) {
      this.deep = !!options.deep;
      this.user = !!options.user;
      this.lazy = !!options.lazy;
      this.sync = !!options.sync;
      this.before = options.before;
    } else {
      this.deep = this.user = this.lazy = this.sync = false;
    }
    this.cb = cb;
    this.id = ++uid; // uid for batching
    this.active = true;
    this.dirty = this.lazy; // for lazy watchers
    this.deps = [];
    this.newDeps = [];
    this.depIds = new Set();
    this.newDepIds = new Set();
    this.expression =
      process.env.NODE_ENV !== 'production' ? expOrFn.toString() : '';
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn; // 如果取值函数是个函数，则直接赋值给getter
    } else {
      this.getter = parsePath(expOrFn); // 如果取值函数是个字符串（自定义watcher内属性路径函数名），则生成一个取对象属性的函数
      if (!this.getter) {
        // 这种情况出现在字符串对象路径不为.取值方式，使用了[ ]取属性方式
        this.getter = noop;
        process.env.NODE_ENV !== 'production' &&
          warn(
            `Failed watching path: "${expOrFn}" ` +
              'Watcher only accepts simple dot-delimited paths. ' +
              'For full control, use a function instead.',
            vm
          );
      }
    }
    this.value = this.lazy // 如果不是惰性取值则立刻取值
      ? undefined
      : this.get();
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  // 取值操作，这里会触发所有观察者getter收集依赖
  get() {
    pushTarget(this); // 当前订阅者入订阅器栈
    let value;
    const vm = this.vm;
    try {
      value = this.getter.call(vm, vm); // 取一次值，这里会触发所有数据观察者收集依赖
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`);
      } else {
        throw e;
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value); // 递归访问所有属性值，触发所有getter
      }
      popTarget(); // 出栈
      this.cleanupDeps(); // 清理上一次订阅器的关联表
    }
    return value;
  }

  /**
   * Add a dependency to this directive.
   */
  // 添加订阅器关联，确保相同的依赖不会重复添加
  addDep(dep: Dep) {
    const id = dep.id;
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id);
      this.newDeps.push(dep);
      if (!this.depIds.has(id)) {
        dep.addSub(this); // 为订阅器添加当前订阅者
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  // 移除不在新订阅器id表内的订阅器，每次更新都会将不再需要订阅的移除
  cleanupDeps() {
    let i = this.deps.length;
    while (i--) {
      const dep = this.deps[i];
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this);
      }
    }
    let tmp = this.depIds; // 新的表加入当前表字段中，然后将新表清空
    this.depIds = this.newDepIds;
    this.newDepIds = tmp;
    this.newDepIds.clear();
    tmp = this.deps;
    this.deps = this.newDeps;
    this.newDeps = tmp;
    this.newDeps.length = 0;
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  // 更新订阅者接口，如果是惰性取值则标记dirty，然后在evaluate中才更新取
  update() {
    /* istanbul ignore else */
    if (this.lazy) {
      // 计算watcher会懒取值
      this.dirty = true;
    } else if (this.sync) {
      // 这个同步更新目前没见到,其实在自定义watcher可以设置sync让其同步更新
      this.run();
    } else {
      // 自定义watcher和渲染会走异步队列
      queueWatcher(this); // 并不是每次数据改变就立刻触发，而是推入队列中异步更新订阅者
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  // 更新订阅者的任务，也是在调度器队列里的任务最终回调
  run() {
    if (this.active) {
      const value = this.get(); // 取一次值，这里会触发所有数据观察者收集依赖
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // 当新值与旧值不一致，或者是对象、数组，或者配置了deep就触发回调
        // set new value
        const oldValue = this.value;
        this.value = value;
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue); // 这里的cb就是上面说的更新后的回调，大部分情况在watch的handler
          } catch (e) {
            handleError(
              e,
              this.vm,
              `callback for watcher "${this.expression}"`
            );
          }
        } else {
          this.cb.call(this.vm, value, oldValue); // 这里的cb就是上面说的更新后的回调，大部分情况在watch的handler
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate() {
    // 这里在dirty为true时才会调用，在计算watcher内的
    this.value = this.get(); // 获取值，并在外部获取watcher.value
    this.dirty = false; // 获取过了就改回去
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  /**
   * 这里是将本次watcher在订阅中的订阅器都被栈顶的watcher订阅，调用时是computed的getter，
   * 此时计算watcher已出栈，栈内是渲染watcher，通过遍历本次watcher里的deps库，让渲染watcher都去订阅他们，
   * 意思是，计算属性依赖的data都会被渲染watcher订阅
   */
  depend() {
    let i = this.deps.length;
    while (i--) {
      this.deps[i].depend();
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  // 移除所有订阅器上自身的订阅，在组件移除，$watch返回的unwatch上使用
  teardown() {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this);
      }
      let i = this.deps.length;
      while (i--) {
        this.deps[i].removeSub(this);
      }
      this.active = false;
    }
  }
}
```

#### Watcher 内的 depend 有什么用

该方法会在 computed 属性内调用 getter 时调用。

depend 在 Watcher 类里的意思是，将本次`计算Watcher`所订阅的属性，都会被`渲染Watcher`订阅，如此知道渲染其实直接订阅的是 computed 里的依赖，并非订阅了 computed，视图并不知道 computed 的更新。证明方法是：computed 内设置 get 和 set，并且使用一个非 observable 的数据，如直接在 window 上定义一个变量，此次 computed 关联他，记得在更改时，调用下 vm 上的\_computedWatchers 内本次 watcher 的 run，因为无劫持数据，computed 不知道你的数据更新了。此时更改 computed 数据，视图并未更新。

## 异步执行调度器

这块是 Vue 内的异步执行调度器，在[vue/src/core/scheduler.js](https://github.com/vuejs/vue/blob/v2.6.11/src/core/observer/scheduler.js)内。

```javascript
import type Watcher from './watcher';
import config from '../config';
import { callHook, activateChildComponent } from '../instance/lifecycle';

import { warn, nextTick, devtools, inBrowser, isIE } from '../util/index';

export const MAX_UPDATE_COUNT = 100;

const queue: Array<Watcher> = [];
const activatedChildren: Array<Component> = [];
let has: { [key: number]: ?true } = {};
let circular: { [key: number]: number } = {};
let waiting = false;
let flushing = false;
let index = 0;

/**
 * Reset the scheduler's state.
 */
// 重置运行状态的方法
function resetSchedulerState() {
  index = queue.length = activatedChildren.length = 0;
  has = {};
  if (process.env.NODE_ENV !== 'production') {
    circular = {};
  }
  waiting = flushing = false;
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0;

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now;

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance;
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now();
  }
}

/**
 * Flush both queues and run the watchers.
 */
function flushSchedulerQueue() {
  currentFlushTimestamp = getNow();
  flushing = true;
  let watcher, id;

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child)
  // 2. A component's user watchers are run before its render watcher (because
  //    user watchers are created before the render watcher)
  // 3. If a component is destroyed during a parent component's watcher run,
  //    its watchers can be skipped.
  queue.sort((a, b) => a.id - b.id); // 这里需要排一个序，确保更新从父再到子，自定义wathcer需要早于渲染watcher，如果一个组件在父组件的watcher运行中销毁，他也可以被跳过

  // do not cache length because more watchers might be pushed
  // as we run existing watchers
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index];
    if (watcher.before) {
      watcher.before();
    }
    id = watcher.id;
    has[id] = null;
    watcher.run();
    // in dev build, check and stop circular updates.
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1;
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' +
            (watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`),
          watcher.vm
        );
        break;
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice();
  const updatedQueue = queue.slice();

  resetSchedulerState(); // 重置状态

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue);
  callUpdatedHooks(updatedQueue);

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush');
  }
}

function callUpdatedHooks(queue) {
  let i = queue.length;
  while (i--) {
    const watcher = queue[i];
    const vm = watcher.vm;
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated');
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent(vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false;
  activatedChildren.push(vm);
}

function callActivatedHooks(queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true;
    activateChildComponent(queue[i], true /* true */);
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
// 这里是将需要更新的watcher推进队列中，在下一个tick批量运行
export function queueWatcher(watcher: Watcher) {
  const id = watcher.id;
  if (has[id] == null) {
    // 先保证同一个watcher只会添加一次
    has[id] = true;
    if (!flushing) {
      queue.push(watcher); // 如果没在运行中就直接插入队列
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      let i = queue.length - 1;
      while (i > index && queue[i].id > watcher.id) {
        i--;
      }
      queue.splice(i + 1, 0, watcher); // 在运行中就找到id所在的位置插入
    }
    // queue the flush
    if (!waiting) {
      // 在准备运行中就不要再启动了
      waiting = true;

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue();
        return;
      }
      nextTick(flushSchedulerQueue); // nextTick即下一微任务优先，不支持就下一宏任务
    }
  }
}
```

## 总结

整个 Vue 的响应式源码大概就是这样，需要 Observer、Dep、Watcher 互相配合，而数据流动是这样的：

1. new Vue 时获取 data 并走 Observer，对数据劫持了 getter 和 setter，并且创建了 Dep 并持有了它。
2. 渲染模板时创建 Watcher，并调用 get 更新一次，watcher 推入 Dep 栈中，并触发渲染，渲染时使用到了 data 中的数据会触发所有数据获取操作。
3. 触发 getter 内的 dep.depend 收集依赖，将 Dep.target 中的 watcher 收集到自己身上，watcher 也将当前 dep 收集到自己身上。
4. 到这里初次渲染绑定依赖完成。
5. 更改数据触发数据观察者内的 setter 调用 dep.notify，通知 dep 内所有 wathcer。
6. watcher 更新，这时候就是重复上面第 2 步的步骤了。
