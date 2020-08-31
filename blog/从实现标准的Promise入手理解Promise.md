# 从实现标准的Promise入手理解Promise

## 什么是Promise
`Promise` 是异步编程的一种解决方案，比传统的解决方案——回调函数和事件——更合理和更强大。它由社区最早提出和实现，ES6 将其写进了语言标准，统一了用法，原生提供了`Promise`对象。

所谓`Promise`，简单说就是一个容器，里面保存着某个未来才会结束的事件（通常是一个异步操作）的结果。从语法上说，`Promise` 是一个对象，从它可以获取异步操作的消息。`Promise` 提供统一的 API，各种异步操作都可以用同样的方法进行处理，**并非只能解决读取接口这种异步操作**。

## 在此之前如何解决异步操作
在Promise出现之前其实也有出现了类Promise的库，例如[Q](https://github.com/kriskowal/q)和[JQuery](https://github.com/jquery/jquery)Deferred等。但是通用的解决方案就是回调函数。

回调函数本身是没问题的，但是如果需要一个接一个调用（嵌套）时，很容易掉入回调地狱
```javascript
ajax({
  url: './index',
  success: function (value) {
    ajax({
      url: value.url,
      success: function (value2) {
        ajax({
          url: value2.url,
          success: function (value3) {
            ajax({
              url: value3.url,
              success: function (value4) {
                // .. do something else
              },
            });
          },
        });
      },
    });
  },
});
```

在有Promise后就可以写成：
```javascript
const request = url =>
  new Promise((resolve, reject) => {
    ajax({
      url,
      success: resolve,
      fail: reject,
    });
  });

request('.index')
  .then(({ url }) => request(url))
  .then(({ url }) => request(url))
  .then(({ url }) => request(url))
  .then(value4 => {
    // .. do something else
  });

```
甚至在配合es2017中的async函数可以写成：
```javascript
(async () => {
  const { url } = await request('.index');
  const { url: url2 } = await request(url);
  const { url: url3 } = await request(url2);
  const value4 = await request(url3);
  // .. do something else
})();
```
整个代码就清晰易懂而且优雅简洁。

## Promise特点
`Promise`对象有以下两个特点。

（1）对象的状态不受外界影响。`Promise`对象代表一个异步操作，有三种状态：pending（进行中）、fulfilled（已成功）和rejected（已失败）。只有异步操作的结果，可以决定当前是哪一种状态，任何其他操作都无法改变这个状态。这也是`Promise`这个名字的由来，它的英语意思就是“承诺”，表示其他手段无法改变。

（2）**一旦状态改变，就不会再变，任何时候都可以得到这个结果**。`Promise`对象的状态改变，只有两种可能：从pending变为fulfilled和从pending变为rejected。只要这两种情况发生，状态就凝固了，不会再变了，会一直保持这个结果，这时就称为 resolved（已定型）。如果改变已经发生了，你再对`Promise`对象添加回调函数，也会立即得到这个结果。这与事件（Event）完全不同，事件的特点是，如果你错过了它，再去监听，是得不到结果的。

## Promise的api和用法
这里就不详细列举了，详细可以参考es6入门中的[Promise章](https://es6.ruanyifeng.com/#docs/promise)。
下面会默认读者已清楚了解Promise的api。

## Promise规范
关于Promise的规范最早是由commonjs社区提出，毕竟多人接收的就是[Promise/A](http://wiki.commonjs.org/wiki/Promises/A)，后面因规范较为简单所以在这基础上提出了[Promise/A+](https://promisesaplus.com/#point-27)，这也是业界和ES6使用的标准，而ES6在这标准上还新增了Promise.resolve、Promise.reject、Promise.all、Promise.race、Promise.prototype.catch、Promise.allSettled、Promise.prototype.finally等方法。

而测试是否符合Promise/A+标准的可以使用[promises-aplus-tests](https://github.com/promises-aplus/promises-tests)库来测试，使用方法为在自己实现的MyPromise文件中加入如下代码导出
```javascript
// MyPromise.js
MyPromise.defer = MyPromise.deferred = function () {
    let dfd = {};
    dfd.promise = new MyPromise((resolve, reject) => {
        dfd.resolve = resolve;
        dfd.reject = reject;
    });
    return dfd;
};

module.exports = MyPromise;
```
然后可以安装并在文件目录内运行
```bash
npm install -g promises-aplus-tests

promises-aplus-tests MyPromise.js
```

## Promise结构
可以从日常使用Promise中了解到，Promise需要new出实例，并且传入回调函数，而回调函数接收两个参数（resolve、reject），回调函数会立刻执行。返回的Promise实例中可调用then或者catch接收完成和错误。

Promise拥有三种状态分别为`pending`等待中、`fulfilled`已完成、`rejected`已拒绝，并且初始为等待中，且如果更改了状态则无法再更改。

而`Promise.prototype.then`可以接收两个参数，分别是`onFulfilled`和`onRejected`回调函数，`Promise.prototype.catch`只能接收`onRejected`。

```javascript
const STATUS = {
  PENDING: 'PENDING', // 等待中
  FULFILLED: 'FULFILLED', // 已完成
  REJECTED: 'REJECTED', // 已拒绝
};

class MyPromise {
  status = STATUS.PENDING; // 初始化状态为等待中

  constructor(executor) {
    const resolve = value => {};
    const reject = reason => {};
    try {
      executor(resolve, reject); // 实例化即刻执行
    } catch (err) {
      reject(err); // 发生错误则被捕捉
    }
  }

  then(onFulfiled, onRejected) {}
}
```

我们发现Promise对象在每次使用then或者catch后获取的值都会一致不变，而且在完成前多个then或者catch监听会在完成、拒绝后一个个调用，所以知道这里会保存值和错误以及维护一个完成和拒绝的队列
```javascript
const STATUS = {
  PENDING: 'PENDING', // 等待中
  FULFILLED: 'FULFILLED', // 已完成
  REJECTED: 'REJECTED', // 已拒绝
};

class MyPromise {
  status = STATUS.PENDING; // 初始化状态为等待中
  resolveQueue = []; // 完成回调队列
  rejectQueue = []; // 拒绝回调队列
  value = undefined; // 完成的值
  reason = undefined; // 拒绝的理由

  constructor(executor) {
    const resolve = value => {
      if (this.status === STATUS.PENDING) {
        // 只有在等待中的状态才可以resolve
        this.status = STATUS.FULFILLED; // 修改状态
        this.value = value; // 保存值
        queueMicrotask(() => {
          // 当然这里可以用setTimeout模拟，只不过这个才是真正的创建了微任务
          while (this.resolveQueue.length) {
            const callback = this.resolveQueue.shift();
            callback(value); // 一个个执行
          }
        });
      }
    };
    const reject = reason => { // 与resolve一致，只是修改的状态和保存的理由以及执行的队列不一样
      if (this.status === STATUS.PENDING) {
        this.status = STATUS.REJECTED;
        this.reason = reason;
        queueMicrotask(() => {
          while (this.rejectQueue.length) {
            const callback = this.rejectQueue.shift(); // 获取拒绝回调队列
            callback(reason);
          }
        });
      }
    };
    try {
      executor(resolve, reject); // 实例化即刻执行
    } catch (err) {
      reject(err); // 发生错误则被捕捉
    }
  }

  then(onFulfiled, onRejected) {}
}
```

到这里，构造函数已经差不多了，剩下的开始实现`then`方法。
我们知道，then后面可以链式调用then，并且**then获取的值为上一个then返回的新Promise对象中的值**，很多人误认为链式调用获取的是链式的头的Promise，其实不然，Promise每个then都会创建一个新Promise，所以你下一个then跟最前面的Promise不一定有关系。
而且，如果then中传入的不是函数，则会直接传出，直到被传入函数的then捕捉。
然后，在调用then时，Promise对象可能为三种状态，但是即使是已完成或已拒绝，也不会立刻执行，而是被推入微任务队列中。
```javascript

class MyPromise {
  then(onFulfilled, onRejected) {
    onFulfilled =
      typeof onFulfilled === 'function' ? onFulfilled : value => value; // 如果不是函数则传递给下一个
    onRejected =
      typeof onRejected === 'function'
        ? onRejected
        : reason => {
            throw reason;
          };
    return new MyPromise((resolve, reject) => {
      if (this.status === STATUS.FULFILLED) {
        queueMicrotask(() => {
          // 即使Promise对象是已完成，也不会立刻执行
          const result = onFulfilled(this.value); // 传入的回调可以获取值
          resolve(result);
        });
      } else if (this.status === STATUS.REJECTED) {
        queueMicrotask(() => {
          // 即使Promise对象是已拒绝，也不会立刻执行
          const result = onRejected(this.reason); // 传入的回调可以拒绝理由
          reject(result);
        });
      } else if (this.status === STATUS.PENDING) {
        // 如果是等待中，则分别推入回调队列中
        this.resolveQueue.push(() => {
          const result = onFulfilled(this.value);
          resolve(result);
        });
        this.rejectQueue.push(() => {
          const result = onRejected(this.reason);
          reject(result);
        });
      }
    });
  }
}
```

到这里为止，基本差不多了，然而并没有这么简单。回调函数可能是任何值，包括返回了一个Promise对象，这种情况需要以返回的Promise为准。
所以这里可以封装出一个方法专门处理Promise以及其回调，以适配所有标准
```javascript
const resolvePromise = (newPromise, result, resolve, reject) => {
  // 规范2.3.1，避免循环引用
  if (newPromise === result) {
    return reject(new TypeError('Circular reference'));
  }
  // 用来判断resolvePormise是否已经执行过了，如果执行过resolve或者reject就不要再往下走resolve或者reject
  // 在一些返回thenable对象中，连续调用多次回调的情况
  let called = false;
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function')
  ) {
    try {
      const { then } = result;
      if (typeof then === 'function') {
        // 规范2.3.3.3 如果result是个thenable对象，则调用其then方法，当他是Promise
        then.call(
          result,
          value => {
            if (!called) {
              called = true;
              resolvePromise(newPromise, value, resolve, reject); // 这里需要递归取值，直到不是Promise为止
            }
          },
          reason => {
            if (!called) {
              called = true;
              reject(reason);
            }
          }
        );
      } else {
        // 规范2.3.3.4 如果 result不是thenable对象，则返回fulfilled
        resolve(result);
      }
    } catch (err) {
      if (!called) {
        called = true;
        reject(err);
      }
    }
  } else {
    resolve(result);
  }
};
```

所以then方法改为
```javascript
then(onFulfilled, onRejected) {
  onFulfilled =
    typeof onFulfilled === 'function' ? onFulfilled : value => value; // 如果不是函数则传递给下一个
  onRejected =
    typeof onRejected === 'function'
      ? onRejected
      : reason => {
          throw reason;
        };
  let newPromise;
  return (newPromise = new MyPromise((resolve, reject) => {
    if (this.status === STATUS.FULFILLED) {
      queueMicrotask(() => {
        // 即使Promise对象是已完成，也不会立刻执行
        try {
          const result = onFulfilled(this.value); // 传入的回调可以获取值
          resolvePormise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    } else if (this.status === STATUS.REJECTED) {
      queueMicrotask(() => {
        // 即使Promise对象是已拒绝，也不会立刻执行
        try {
          const result = onRejected(this.reason); // 传入的回调可以拒绝理由
          resolvePormise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    } else if (this.status === STATUS.PENDING) {
      // 如果是等待中，则分别推入回调队列中
      this.resolveQueue.push(() => {
        try {
          const result = onFulfilled(this.value);
          resolvePormise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
      this.rejectQueue.push(() => {
        try {
          const result = onRejected(this.reason);
          resolvePormise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    }
  }));
}
```
最后加入上面说的测试导出，跑一次测试即可
![测试结果](https://raw.githubusercontent.com/ben-lau/blog/master/assets/promise.png)
827个测试项全通过~！

剩下的可以增加一些api实现和判断即可

**[完整代码在这里](https://github.com/ben-lau/blog/blob/master/assets/MyPromise.js)**