// const { requestTimeout } = (() => {
//   const cacheMap = new Map();
//   const getNow =
//     typeof process !== 'undefined'
//       ? () => process.uptime() * 1000
//       : () => new Event('').timeStamp;
//   let id = 0;
//   const ratio = 0.1;

//   const requestTimeout = (fn, delay = 0) => {
//     let previousTimeStamp = getNow();
//     const targetTimestamp = previousTimeStamp + delay;
//     id++;
//     cacheMap.set(id, { pause: false });

//     const requestScheduler = () => {
//       previousTimeStamp = getNow();
//       const restDelay = targetTimestamp - previousTimeStamp;
//       const nearTheEdge = restDelay <= 1;

//       setTimeout(
//         () => {
//           nearTheEdge ? fn() : requestScheduler();
//         },
//         nearTheEdge ? restDelay : restDelay * ratio
//       );
//     };

//     requestScheduler();
//     return id;
//   };
//   return { requestTimeout };
// })();

// const getNow =
//   typeof process !== 'undefined'
//     ? () => process.uptime() * 1000
//     : () => new Event('').timeStamp;
// let n1 = 0;
// let p = getNow();
// const tick = () => {
//   requestTimeout(() => {
//     n1++;
//     const now = getNow();
//     console.log(now - p);
//     p = now;
//     tick();
//   }, 1000);
// };
// tick();

const { requestInterval, cancelInterval } = (() => {
  const cacheMap = new Map();
  const getNow =
    typeof process !== 'undefined'
      ? () => process.uptime() * 1000
      : () => new Event('').timeStamp;
  let id = 0;

  const requestInterval = (fn, interval = 0) => {
    id++;
    cacheMap.set(id, { pause: false });
    let previousTimeStamp = getNow();

    const requestScheduler = (currentInterval = interval) => {
      if (!cacheMap.get(id).pause) {
        setTimeout(() => {
          const currentTimeStamp = getNow();
          const realInterval = currentTimeStamp - previousTimeStamp;
          const delta = interval + (interval - realInterval);
          const nextInterval = delta > 0 ? delta : 0;
          const skipTimes = Math.floor((realInterval - interval) / interval);
          previousTimeStamp = currentTimeStamp;
          fn(skipTimes > 0 ? skipTimes : 0);
          requestScheduler(nextInterval);
        }, currentInterval);
      }
    };

    requestScheduler();
    return id;
  };

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

/**
 * setTimeout测试对照组
 */
console.time('setTimeout');
let n1 = 0;
const tick = () => {
  setTimeout(() => {
    n1++;
    if (n1 === 60) {
      console.timeEnd('setTimeout');
    } else {
      tick();
    }
  }, 1000);
};
tick();

/**
 * setInterval测试对照组
 */
console.time('setInterval');
let n2 = 0;
const timer1 = setInterval(() => {
  n2++;
  if (n2 === 60) {
    console.timeEnd('setInterval');
    clearInterval(timer1);
  }
}, 1000);

/**
 * requestInterval测试对照组
 */
console.time('requestInterval1');
let n3 = 0;
const timer2 = requestInterval(() => {
  n3++;
  if (n3 === 60) {
    console.timeEnd('requestInterval1');
    cancelInterval(timer2);
  }
}, 1000);

/**
 * requestInterval测试对照组
 */
console.time('requestInterval2');
let n4 = 0;
const timer3 = requestInterval(() => {
  n4++;
  if (n4 === 60) {
    console.timeEnd('requestInterval2');
    cancelInterval(timer3);
  }
}, 1000);
/**
 * requestInterval测试对照组
 */
console.time('requestInterval3');
let n5 = 0;
const timer4 = requestInterval(() => {
  n5++;
  if (n5 === 60) {
    console.timeEnd('requestInterval3');
    cancelInterval(timer4);
  }
}, 1000);
