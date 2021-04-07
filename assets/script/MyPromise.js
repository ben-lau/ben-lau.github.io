const STATUS = {
  PENDING: 'pending', // 等待中
  FULFILLED: 'fulfilled', // 已完成
  REJECTED: 'rejected', // 已拒绝
};

// 判断是否原生方法
const isNativeFunction = Ctor =>
  typeof Ctor === 'function' && /native code/.test(Ctor.toString());

// 判断是否可迭代对象
const isIterable = Ctor =>
  ((typeof Ctor === 'object' && Ctor !== null) || typeof Ctor === 'string') &&
  typeof Ctor[Symbol.iterator] === 'function';

// 推入微任务队列
const nextTaskQueue = cb => {
  if (
    typeof queueMicrotask !== 'undefined' &&
    isNativeFunction(queueMicrotask)
  ) {
    queueMicrotask(cb);
  } else if (
    typeof MutationObserver !== 'undefined' &&
    (isNativeFunction(MutationObserver) ||
      MutationObserver.toString() === '[object MutationObserverConstructor]')
  ) {
    const observer = new MutationObserver(cb);
    const node = document.createTextNode('1');
    observer.observe(node, {
      characterData: true,
    });
    node.data = '2';
  } else if (
    typeof process !== 'undefined' &&
    typeof process.nextTick === 'function'
  ) {
    process.nextTick(cb);
  } else {
    setTimeout(() => {
      cb();
    }, 0);
  }
};

class MyPromise {
  _resolveQueue = []; // 完成回调队列
  _rejectQueue = []; // 拒绝回调队列
  result = void 0; // 完成的值
  state = STATUS.PENDING; // 初始化状态为等待中

  constructor(executor) {
    if (typeof executor !== 'function') {
      throw TypeError('MyPromise executor is not a function');
    }

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
      // 真正的创建了微任务的封装
      this.state = STATUS.FULFILLED; // 修改状态
      this.result = value; // 保存值
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

  catch(onRejected) {
    return this.then(null, onRejected);
  }

  finally(onFinally) {
    return this.then(
      value => MyPromise.resolve(onFinally()).then(() => value),
      reason =>
        MyPromise.resolve(onFinally()).then(() => {
          throw reason;
        })
    );
  }

  static resolve(value) {
    /**
     * 这里是因为Promise.resolve内Promise对象，
     * 将会以传入的Promise为准，即使传入的是Promise.reject，
     * 也会返回一个rejected的Promise对象
     */
    if (value instanceof MyPromise) {
      return value;
    } else {
      return new MyPromise(resolve => {
        resolve(value);
      });
    }
  }

  static reject(value) {
    /**
     * Promise.reject则会直接创造一个rejected的Promise，
     * 无论内部是否为Promise对象
     */
    return new MyPromise((_, reject) => {
      reject(value);
    });
  }

  static all(promiseList) {
    if (!isIterable(promiseList)) {
      throw TypeError(`${promiseList} is not iterable`);
    }
    return new MyPromise((resolve, reject) => {
      let resolveCount = 0;
      const resultList = [];
      // 迭代对象传成数组，所有元素都会进入判断
      const list = [...promiseList];
      const length = list.length;
      if (length === 0) {
        resolve(list);
      } else {
        list.forEach((p, index) => {
          MyPromise.resolve(p).then(
            value => {
              resolveCount++;
              resultList[index] = value;
              if (resolveCount === length) {
                resolve(resultList);
              }
            },
            reason => {
              reject(reason);
            }
          );
        });
      }
    });
  }

  static race(promiseList) {
    if (!isIterable(promiseList)) {
      throw TypeError(`${promiseList} is not iterable`);
    }
    return new MyPromise((resolve, reject) => {
      const list = [...promiseList];
      const length = list.length;
      if (length === 0) {
        resolve(list);
      } else {
        list.forEach(p => {
          MyPromise.resolve(p).then(
            value => {
              resolve(value);
            },
            reason => {
              reject(reason);
            }
          );
        });
      }
    });
  }

  static allSettled(promiseList) {
    if (!isIterable(promiseList)) {
      throw TypeError(`${promiseList} is not iterable`);
    }
    return new MyPromise(resolve => {
      let settledCount = 0;
      const resultList = [];
      const list = [...promiseList];
      const length = list.length;
      if (length === 0) {
        resolve(list);
      } else {
        // 根据提案要求，allSettled会在所有promise完成或者拒绝后执行
        // 一定返回then内，对于每个结果对象，都有一个 status 字符串。如
        // 果它的值为 fulfilled，则结果对象上存在一个 value 。如果值为
        // rejected，则存在一个 reason 。value（或 reason ）反映了每
        // 个 promise 决议（或拒绝）的值。
        list.forEach((p, index) => {
          MyPromise.resolve(p).then(
            value => {
              settledCount++;
              resultList[index] = {
                status: STATUS.FULFILLED,
                value,
              };
              if (settledCount === length) {
                resolve(resultList);
              }
            },
            reason => {
              settledCount++;
              resultList[index] = {
                status: STATUS.REJECTED,
                reason,
              };
              if (settledCount === length) {
                resolve(resultList);
              }
            }
          );
        });
      }
    });
  }

  static any(promiseList) {
    if (!isIterable(promiseList)) {
      throw TypeError(`${promiseList} is not iterable`);
    }
    return new Promise((resolve, reject) => {
      let errorCount = 0;
      const errorResultList = [];
      const list = [...promiseList];
      const length = list.length;
      if (length === 0) {
        resolve(list);
      } else {
        list.forEach((p, index) => {
          MyPromise.resolve(p).then(
            value => {
              resolve(value);
            },
            reason => {
              errorCount++;
              errorResultList[index] = reason;
              if (errorCount === length) {
                reject(errorResultList);
              }
            }
          );
        });
      }
    });
  }
}

const resolvePromise = (newPromise, result, resolve, reject) => {
  /**
   * 规范2.3.1，避免循环引用
   * e.g. const p = Promise.resolve().then(() => p);
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
