const { requestTimeout, cancelTimeout } = (() => {
  // 建立的任务表
  const cacheMap = new Map();
  // 获取当前相对时间戳
  const getNow =
    typeof process !== 'undefined'
      ? () => process.uptime() * 1000
      : () => new Event('').timeStamp;
  const RATIO = 0.1; // 拆解timer时间系数
  const EDGE = 10; // 边界值
  let id = 0;

  /**
   * 请求延迟回调
   * @param {Function} fn 回调函数
   * @param {number} delay 延迟时间
   * @param {boolean} isBlock 是否使用阻塞
   * @returns {number} id
   */
  const requestTimeout = (fn, delay = 0, isBlock = false) => {
    id++;
    cacheMap.set(id, { pause: false });
    // 获取是否允许继续
    const getAllowContinue = () => !cacheMap.get(id).pause;
    // 上一次调度器执行的时间戳
    let previousTimeStamp = getNow();
    // 目标时间戳
    const targetTimestamp = previousTimeStamp + delay;

    // 调度器
    const requestScheduler = isBlock
      ? () => {
          if (getAllowContinue()) {
            // 阻塞
            while (
              getNow() - previousTimeStamp < delay &&
              getAllowContinue()
            ) {}
            fn();
          }
        }
      : () => {
          if (getAllowContinue()) {
            previousTimeStamp = getNow();
            // 获取剩余延迟时间
            const restDelay = targetTimestamp - previousTimeStamp;
            // 判断是否剩余小于边界值的时间
            const nearTheEdge = restDelay <= EDGE;
            setTimeout(
              () => {
                nearTheEdge ? fn() : requestScheduler();
              },
              nearTheEdge ? restDelay : restDelay * RATIO
            );
          }
        };

    requestScheduler();
    return id;
  };

  /**
   * 取消延迟任务
   * @param {number} id 任务id
   * @returns {void}
   */
  const cancelTimeout = id => {
    if (cacheMap.has(id)) {
      const cache = cacheMap.get(id);
      cache.pause = true;
    }
  };

  return {
    requestTimeout,
    cancelTimeout,
  };
})();

const { requestInterval, cancelInterval } = (() => {
  // 建立的任务表
  const cacheMap = new Map();
  // 获取当前相对时间戳
  const getNow =
    typeof process !== 'undefined'
      ? () => process.uptime() * 1000
      : () => new Event('').timeStamp;
  let id = 0;

  /**
   * 请求间隔调用
   * @param {Function} fn 回调函数
   * @param {number} interval 间隔时间
   * @returns {number} id
   */
  const requestInterval = (fn, interval = 0) => {
    id++;
    cacheMap.set(id, { pause: false });
    // 上一调度器执行时间戳
    let previousTimeStamp = getNow();
    // 获取是否允许继续
    const getAllowContinue = () => !cacheMap.get(id).pause;

    // 调度器
    const requestScheduler = (currentInterval = interval) => {
      if (getAllowContinue()) {
        requestTimeout(() => {
          const currentTimeStamp = getNow(); // 当前时间戳
          const realInterval = currentTimeStamp - previousTimeStamp; // 本次和上次的真实间隔
          const delta = interval + (interval - realInterval); // 间隔差值
          const nextInterval = delta > 0 ? delta : 0; // 下一次间隔时间
          const skipTimes = Math.floor((realInterval - interval) / interval); // 被跳过的次数（被阻塞或者睡眠）
          previousTimeStamp = currentTimeStamp;
          fn(skipTimes > 0 ? skipTimes : 0);
          requestScheduler(nextInterval);
        }, currentInterval);
      }
    };

    requestScheduler();
    return id;
  };

  /**
   * 取消间隔任务
   * @param {number} id 任务id
   * @returns {void}
   */
  const cancelInterval = id => {
    if (cacheMap.has(id)) {
      const cache = cacheMap.get(id);
      cache.pause = true;
    }
  };

  return {
    requestInterval,
    cancelInterval,
  };
})();

// ********************************************************
// **********************以下都是测试对照*********************
// ********************************************************

/**
 * 60次requestTimeout递归测试
 */
(() => {
  let n1 = 0;
  const tick1 = () => {
    requestTimeout(() => {
      n1++;
      if (n1 >= 60) {
        console.timeEnd('60 times requestTimeout');
      } else {
        tick1();
      }
    }, 1000);
  };
  console.time('60 times requestTimeout');
  tick1();
})();

/**
 * setTimeout测试对照组
 */
(() => {
  let n2 = 0;
  const tick2 = () => {
    setTimeout(() => {
      n2++;
      if (n2 === 60) {
        console.timeEnd('setTimeout');
      } else {
        tick2();
      }
    }, 1000);
  };
  console.time('setTimeout');
  tick2();
})();

/**
 * setInterval测试对照组
 */
(() => {
  console.time('setInterval');
  let n3 = 0;
  const timer1 = setInterval(() => {
    n3++;
    if (n3 === 60) {
      console.timeEnd('setInterval');
      clearInterval(timer1);
    }
  }, 1000);
})();

/**
 * requestInterval测试对照组1
 */
(() => {
  console.time('requestInterval1');
  let n4 = 0;
  const timer2 = requestInterval(skip => {
    n4 = n4 + skip + 1;
    if (n4 === 60) {
      console.timeEnd('requestInterval1');
      cancelInterval(timer2);
    }
  }, 1000);
})();

/**
 * requestInterval测试对照组2
 */
(() => {
  console.time('requestInterval2');
  let n5 = 0;
  const timer3 = requestInterval(skip => {
    n5 = n5 + skip + 1;
    if (n5 === 60) {
      console.timeEnd('requestInterval2');
      cancelInterval(timer3);
    }
  }, 1000);
})();

/**
 * requestInterval测试对照组3
 */
(() => {
  console.time('requestInterval3');
  let n6 = 0;
  const timer4 = requestInterval(skip => {
    n6 = n6 + skip + 1;
    if (n6 === 60) {
      console.timeEnd('requestInterval3');
      cancelInterval(timer4);
    }
  }, 1000);
})();
