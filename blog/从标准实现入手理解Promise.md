# 从标准实现入手理解 Promise

## 为什么写这篇

网上解释已经一抓一大把，但是个人觉得大部分文章可以实现 Promise/A+，但是对真实细节没完全实现：

- 真正的 microtask（大部分用的 setTimeout 代替）
- then 传入回调函数返回 Promise 对象的情况
- 构造函数 executor 的细节，以及 executor 的 resolve 参数传入 Promise 对象的情况
- Promise.resolve 传入 Promise 对象的情况
- Promise 各种静态函数传入的是可迭代对象而非数组
- 介绍清楚循环调用阻止的情况和多次 resolve 阻止的情况

本人用自己浅薄的知识尝试去覆盖最真实的 Promise 所有实现情况，并且用纯 js 实现，从中理解到真正的 Promise 是怎么样的。

## 什么是 Promise

`Promise` 是异步编程的一种解决方案，比传统的解决方案回调函数和事件更合理和更强大。它由社区最早提出和实现，ES6 将其写进了语言标准，统一了用法，原生提供了`Promise`对象。

所谓`Promise`，简单说就是一个容器，里面保存着某个未来才会结束的事件（通常是一个异步操作）的结果。从语法上说，`Promise` 是一个对象，从它可以获取异步操作的消息。`Promise` 提供统一的 API，各种异步操作都可以用同样的方法进行处理，**并非只能解决读取接口这种异步操作**。

## 在此之前如何解决异步操作

在 Promise 出现之前其实也有出现了类 Promise 的库，例如[Q](https://github.com/kriskowal/q)和[JQuery](https://github.com/jquery/jquery)Deferred 等。但是通用的解决方案就是回调函数。

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

在有 Promise 后就可以写成：

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

甚至在配合 es2017 中的 async 函数可以写成：

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

## Promise 特点

`Promise`对象有以下两个特点。

（1）对象的状态不受外界影响。`Promise`对象代表一个异步操作，有三种状态：pending（进行中）、fulfilled（已成功）和 rejected（已失败）。只有异步操作的结果，可以决定当前是哪一种状态，任何其他操作都无法改变这个状态。这也是`Promise`这个名字的由来，它的英语意思就是“承诺”，表示其他手段无法改变。

（2）**一旦状态改变，就不会再变，任何时候都可以得到这个结果**。`Promise`对象的状态改变，只有两种可能：从 pending 变为 fulfilled 和从 pending 变为 rejected。只要这两种情况发生，状态就凝固了，不会再变了，会一直保持这个结果，这时就称为 resolved（已定型）。如果改变已经发生了，你再对`Promise`对象添加回调函数，也会立即得到这个结果。这与事件（Event）完全不同，事件的特点是，如果你错过了它，再去监听，是得不到结果的。

## Promise 的 api 和用法

这里就不详细列举了，详细可以参考 es6 入门中的[Promise 章](https://es6.ruanyifeng.com/#docs/promise)。
下面会默认读者已清楚了解 Promise 的 api。

## 在开始前...

是否能说清楚下面打印的是什么，而且说出思路么？

1.

```javascript
new Promise(res => {
  res();
  console.log(1);
  // 代码块1
})
  .then(() => {
    // 代码块2
    console.log(2);
    new Promise(res => {
      res();
      console.log(3);
    })
      .then(() => {
        // 代码块3
        console.log(4);
        new Promise(res => {
          res();
          console.log(5);
        }).then(() => {
          // 代码块4
          console.log(8);
        });
      })
      .then(() => {
        // 代码块5
        console.log(9);
        new Promise(res => {
          res();
          console.log(10);
        }).then(() => {
          // 代码块6
          console.log(12);
        });
      });
    Promise.resolve()
      .then(() => {
        // 代码块7
        console.log(6);
      })
      .then(() => {
        // 代码块8
        console.log(11);
      });
  })
  .then(() => {
    // 代码块9
    console.log(7);
  });
```

2.

```javascript
Promise.reject(
  new Promise((res, rej) => {
    setTimeout(() => {
      rej(133222);
      res(444);
    }, 2000);
  })
)
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs))
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

3.

```javascript
Promise.resolve(
  new Promise((res, rej) => {
    setTimeout(() => {
      rej(133222);
      res(444);
    }, 2000);
  })
)
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs))
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

4.

```javascript
new Promise((res, rej) => {
  res(Promise.reject(123));
})
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

5.

```javascript
new Promise((res, rej) => {
  rej(Promise.resolve(123));
})
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

6.

```javascript
new Promise(res => res(Promise.resolve())).then(() => console.log(2));

Promise.resolve(Promise.resolve()).then(() => console.log(1));
```

7.

```javascript
Promise.resolve()
  .then(() => {
    console.log(1);
    return Promise.resolve(5);
  })
  .then(r => {
    console.log(r);
  });

Promise.resolve()
  .then(() => {
    console.log(2);
  })
  .then(() => {
    console.log(3);
  })
  .then(() => {
    console.log(4);
  })
  .then(() => {
    console.log(6);
  });
```

可以自己尝试思考再去控制台尝试，如果回答不上就应该往下看啦

## Promise 规范

关于 Promise 的规范最早是由 commonjs 社区提出，毕竟多人接收的就是[Promise/A](http://wiki.commonjs.org/wiki/Promises/A)，后面因规范较为简单所以在这基础上提出了[Promise/A+](https://promisesaplus.com/#point-27)，这也是业界和 ES6 使用的标准，而 ES6 在这标准上还新增了 Promise.resolve、Promise.reject、Promise.all、Promise.race、Promise.prototype.catch、Promise.allSettled、Promise.prototype.finally 等方法。

而测试是否符合 Promise/A+标准的可以使用[promises-aplus-tests](https://github.com/promises-aplus/promises-tests)库来测试，使用方法为在自己实现的 MyPromise 文件中加入如下代码导出

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

## Promise 结构

可以从日常使用 Promise 中了解到，Promise 需要 new 出实例，并且传入回调函数，而回调函数接收两个参数（resolve、reject），回调函数会立刻执行。返回的 Promise 实例中可调用 then 或者 catch 接收完成和错误。

Promise 拥有三种状态分别为`pending`等待中、`fulfilled`已完成、`rejected`已拒绝，并且初始为等待中，且如果更改了状态则无法再更改。

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

我们发现 Promise 对象在每次使用 then 或者 catch 后获取的值都会一致不变，而且在完成前多个 then 或者 catch 监听会在完成、拒绝后一个个调用，所以知道这里会保存值和错误以及维护一个完成和拒绝的队列

```javascript
const STATUS = {
  PENDING: 'PENDING', // 等待中
  FULFILLED: 'FULFILLED', // 已完成
  REJECTED: 'REJECTED', // 已拒绝
};

class MyPromise {
  _resolveQueue = []; // 完成回调队列
  _rejectQueue = []; // 拒绝回调队列
  result = void 0; // 完成的值
  state = STATUS.PENDING; // 初始化状态为等待中

  constructor(executor) {
    const resolve = value => {
      // 只有在等待中的状态才可以resolve
      if (this.state === STATUS.PENDING) {
        try {
          // 如果传入resolve内的为thenable对象，则以它的状态为准
          resolvePromise(this, value, realResolve, reject);
        } catch (err) {
          reject(err);
        }
      }
    };

    const realResolve = value => {
      // 只有在等待中的状态才可以resolve
      this.state = STATUS.FULFILLED; // 修改状态
      this.result = value; // 保存值
      // 真正的创建了微任务的封装
      nextTaskQueue(() => {
        while (this._resolveQueue.length) {
          const callback = this._resolveQueue.shift();
          callback(value); // 一个个执行
        }
      });
    };

    const reject = reason => {
      // 与resolve一致，只是修改的状态和保存的理由以及执行的队列不一样
      if (this.state === STATUS.PENDING) {
        this.state = STATUS.REJECTED;
        this.result = reason;
        nextTaskQueue(() => {
          while (this._rejectQueue.length) {
            const callback = this._rejectQueue.shift(); // 获取拒绝回调队列
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
我们知道，then 后面可以链式调用 then，并且**then 获取的值为上一个 then 返回的新 Promise 对象中的值**，很多人误认为链式调用获取的是链式的头的 Promise，其实不然，Promise 每个 then 都会创建一个新 Promise，所以你下一个 then 跟最前面的 Promise 不一定有关系。
而且，如果 then 中传入的不是函数，则会直接传出，直到被传入函数的 then 捕捉。
然后，在调用 then 时，Promise 对象可能为三种状态，但是即使是已完成或已拒绝，也不会立刻执行，而是被推入微任务队列中。

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
      if (this.state === STATUS.FULFILLED) {
        nextTaskQueue(() => {
          // 即使Promise对象是已完成，也不会立刻执行
          const result = onFulfilled(this.result); // 传入的回调可以获取值
          resolve(result);
        });
      } else if (this.state === STATUS.REJECTED) {
        nextTaskQueue(() => {
          // 即使Promise对象是已拒绝，也不会立刻执行
          const result = onRejected(this.result); // 传入的回调可以拒绝理由
          reject(result);
        });
      } else if (this.state === STATUS.PENDING) {
        // 如果是等待中，则分别推入回调队列中
        this._resolveQueue.push(() => {
          const result = onFulfilled(this.result);
          resolve(result);
        });
        this._rejectQueue.push(() => {
          const result = onRejected(this.result);
          reject(result);
        });
      }
    });
  }
}
```

到这里为止，基本差不多了，然而并没有这么简单。回调函数可能是任何值，包括返回了一个 Promise 对象，这种情况需要以返回的 Promise 为准。
所以这里可以封装出一个方法专门处理 Promise 以及其回调，以适配所有标准

```javascript
const resolvePromise = (newPromise, result, resolve, reject) => {
  /**
   * 规范2.3.1，避免循环引用
   * e.g. const p = MyPromise.resolve().then(() => p);
   */
  if (newPromise === result) {
    return reject(new TypeError('Chaining cycle detected for promise'));
  }
  /**
   * 用来判断resolvePormise是否已经执行过了，如果执行过resolve或者reject就不要再往下走resolve或者reject
   * 在一些返回thenable对象中，连续调用多次回调的情况
   * e.g. then(() => {
   *        return {
   *          then(resolve){
   *            resolve(1);
   *            resolve(2);
   *          }
   *        }
   *      })
   * 网上大部分的都没说这个情况到底是什么
   */
  let called = false;
  if (result !== null && (typeof result === 'object' || isFunction(result))) {
    try {
      const { then } = result;
      if (isFunction(then)) {
        // 规范2.3.3.3 如果result是个thenable对象，则调用其then方法，当他是Promise
        then.call(
          result,
          value => {
            if (!called) {
              called = true;
              // 现代浏览器中，如果then返回是thenable对象则会延迟一次执行，而本身的then又会延迟，所以其实是两次
              nextTaskQueue(() => {
                resolvePromise(newPromise, value, resolve, reject); // 这里需要递归取值，直到不是Promise为止
              });
            }
          },
          reason => {
            if (!called) {
              called = true;
              nextTaskQueue(() => {
                reject(reason);
              });
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

所以 then 方法改为

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
    if (this.state === STATUS.FULFILLED) {
      nextTaskQueue(() => {
        // 即使Promise对象是已完成，也不会立刻执行
        try {
          const result = onFulfilled(this.result); // 传入的回调可以获取值
          resolvePromise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    } else if (this.state === STATUS.REJECTED) {
      nextTaskQueue(() => {
        // 即使Promise对象是已拒绝，也不会立刻执行
        try {
          const result = onRejected(this.result); // 传入的回调可以拒绝理由
          resolvePromise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    } else if (this.state === STATUS.PENDING) {
      // 如果是等待中，则分别推入回调队列中
      this._resolveQueue.push(() => {
        try {
          const result = onFulfilled(this.result);
          resolvePromise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
      this._rejectQueue.push(() => {
        try {
          const result = onRejected(this.result);
          resolvePromise(newPromise, result, resolve, reject);
        } catch (err) {
          reject(err);
        }
      });
    }
  }));
}
```

最后加入上面说的测试导出，跑一次测试即可
![测试结果](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/promise.png)
827 个测试项全通过~！

---

剩下的可以增加一些 api 实现和判断即可。

但是**要注意**的是，静态方法包括 all、race、allSettled、any 等，传入的是任意**可迭代对象**，包括字符串等，如果传入的迭代对象中的子元素如果非 Promise 对象，则直接返回，而即使是非 Promise 对象，也是需要推入微任务在下一 tick 执行（很多实现忽略了这些）。

## tips

因为个人在网上看了很多类似的，但是并没有很完整的解释细节，例如 called 是做什么的。
所以自己总结了一下。

因为发现很多同学觉得 Promise 就是用来封装读接口的通讯方法的，这里表示 Promise**不仅仅可以做读接口封装，还可以做很多有趣的封装**

例如：

- wait 等待几秒后执行

```javascript
const wait = time =>
  new Promise(resolve => {
    const timer = setTimeout(() => resolve(timer), time);
  });

(async () => {
  console.log(1);
  await wait(2000);
  console.log(2);
})();
// print 1
// wait for 2 seconds
// print 2
```

- 早期的小程序 api promise 化，因为本人 16 年开始接触小程序，那时候小程序全是 success 和 fail 回调，用起来很头疼（现在全支持 thenable 调用了），所以做了个 promisify 函数。

```javascript
const promisify =
  wxapi =>
  (options, ...args) =>
    new Promise((resolve, reject) =>
      wxapi.apply(null, [
        {
          ...options,
          success: resolve,
          fail: err => {
            console.log(err);
            reject(err);
          },
        },
        ...args,
      ])
    );

(async () => {
  await promisify(wx.login)();
  await promisify(wx.checkSession)();
  // session有效！
})();

const loading = (title = '加载中..') => {
  promisify(wx.showLoading)({
    title: i18n.getLocaleByName(title),
    mask: true,
  });
};
```

---

## 最后

在了解了源码后，其实可以延伸出一些 Promise 执行顺序的问题

```javascript
new Promise(res => {
  res();
  console.log(1);
  // 代码块1
})
  .then(() => {
    // 代码块2
    console.log(2);
    new Promise(res => {
      res();
      console.log(3);
    })
      .then(() => {
        // 代码块3
        console.log(4);
        new Promise(res => {
          res();
          console.log(5);
        }).then(() => {
          // 代码块4
          console.log(8);
        });
      })
      .then(() => {
        // 代码块5
        console.log(9);
        new Promise(res => {
          res();
          console.log(10);
        }).then(() => {
          // 代码块6
          console.log(12);
        });
      });
    Promise.resolve()
      .then(() => {
        // 代码块7
        console.log(6);
      })
      .then(() => {
        // 代码块8
        console.log(11);
      });
  })
  .then(() => {
    // 代码块9
    console.log(7);
  });
```

以上可以解释一下执行顺序

- tick1、**代码块 1**先执行，resolve 了，将**代码块 2**推入 nextTick，`打印1`
- tick2、**代码块 2**执行，`打印2`，创建 Promise，resolve 了所以将**代码块 3**推入 nextTick，`打印3`；往下走，Promise.resolve 创建了一个 fulfilled 的 Promise，所以**代码块 7**推入 nextTick，执行完毕**代码块 2**，所以**代码块 9**被推入 nextTick
- tick3、**代码块 3**执行，`打印4`，创建 Promise，resolve 了将**代码块 4**推入 nextTick，`打印5`，执行完 then 所以将下一个 then 的**代码块 5**推入 nextTick；然后**代码块 7**执行，`打印6`，执行完所以将下一个 then 的**代码块 8**推入 nextTick；执行**代码块 9**，`打印7`
- tick4、**代码块 4**执行，`打印8`；**代码块 5**执行，`打印9`，创建新 Promise，resolve 了所以将**代码块 6**推入 nextTick，`打印10`；**代码块 8**执行，`打印11`
- tick5、**代码块 6**执行，`打印12`

---

```javascript
Promise.reject(
  new Promise((res, rej) => {
    setTimeout(() => {
      rej(133222);
      res(444);
    }, 2000);
  })
)
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs))
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

这里很容易理解，会**立刻**执行第二个 catch 和第三个 then，打印 pending 中的 Promise 对象和 undefined，因为 Promise.reject 会创建一个已 rejected 的 Promise 对象，value 为传入的值。

```javascript
Promise.resolve(
  new Promise((res, rej) => {
    setTimeout(() => {
      rej(133222);
      res(444);
    }, 2000);
  })
)
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs))
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

但是这里就不一样了，会**等待 2 秒**后，但是还是第二个 catch 和第三个 then。因为 Promise.resolve 如果传入的是 `thenable` 对象，则返回以此为准。

---

```javascript
new Promise((res, rej) => {
  res(Promise.reject(123));
})
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

这里会以为调用 then，因为调用了内部的 resolve 方法，其实不然，这里会走 catch 回调并且打印 catch 和 123，因为 resolve 内如果传入 `thenable` 对象则会一次为准

```javascript
new Promise((res, rej) => {
  rej(Promise.resolve(123));
})
  .then(rs => console.log('then', rs))
  .catch(rs => console.log('catch', rs));
```

而 reject 则不会。

---

```javascript
new Promise(res => res(Promise.resolve())).then(() => console.log(2));

Promise.resolve(Promise.resolve()).then(() => console.log(1));
```

```javascript
Promise.resolve()
  .then(() => {
    console.log(1);
    return Promise.resolve(5);
  })
  .then(r => {
    console.log(r);
  });

Promise.resolve()
  .then(() => {
    console.log(2);
  })
  .then(() => {
    console.log(3);
  })
  .then(() => {
    console.log(4);
  })
  .then(() => {
    console.log(6);
  });
```

```javascript
Promise.resolve()
  .then(() => {
    console.log(1);
    return {
      then(r) {
        r(5);
      },
    };
  })
  .then(r => {
    console.log(r);
  });

Promise.resolve()
  .then(() => {
    console.log(2);
  })
  .then(() => {
    console.log(3);
  })
  .then(() => {
    console.log(4);
  })
  .then(() => {
    console.log(6);
  });
```

这两个可以一块说，大部分网上的例子都没实现这块的逻辑，也是 Promise 的一个需要注意的细节：**就是 resolve、then 传入的回调函数的返回，如果是 Promise 对象，则会延迟两个 tick**。

为什么呢，这块当然涉及到 v8 实现的源码，不说这么复杂简单化来说的话就是，Promise 会先把 then 执行一次，这里会有一个 tick（如果是 thenable 对象则不会），执行这个 then 时传入的回调会包含另一个 tick 的延迟。

## **[完整代码在这里](https://github.com/ben-lau/blog/blob/master/assets/script/MyPromise.js)**
