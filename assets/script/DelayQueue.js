class Timer {
  // 是否启动
  active = false;
  // 本次延时
  #delay = 0;
  // 创建时间
  #timestamp = 0;
  // 定时器实例
  #id = null;
  // 任务内容
  #task = null;
  // 获取已过去的时间
  get passedTime() {
    return this.active ? Date.now() - this.#timestamp : 0;
  }
  // 获取剩余时间
  get restTime() {
    return this.active ? this.#delay - this.passedTime : 0;
  }

  set(task, delay) {
    if (this.#id) {
      this.stop();
    }

    this.#timestamp = Date.now();
    this.#delay = delay;
    this.#task = task;
    this.active = true;
    this.#id = setTimeout(() => {
      this.#task.call(null);
      this.active = false;
    }, this.#delay);
  }

  stop() {
    clearTimeout(this.#id);
    this.active = false;
    this.#delay = 0;
    this.#id = null;
  }
}

class DelayQueue {
  #timer = new Timer();

  #queue = new Set();

  get active() {
    return this.#timer.active;
  }

  add(run, delay = 0) {
    this.#queue.add({
      run,
      delay: delay + this.#timer.passedTime,
    });
    if (this.#timer.restTime > delay || !this.active) {
      this.#setSchedule();
    }
  }

  #refreshRestTime() {
    let minDelay = null;
    const passedTime = this.#timer.passedTime;
    this.#queue.forEach(item => {
      item.delay -= passedTime;
      if (minDelay === null || minDelay > item.delay) {
        minDelay = item.delay;
      }
    });
    return minDelay;
  }

  #getClosestTasks() {
    let results = [];
    let minDelay = null;

    this.#queue.forEach(item => {
      if (minDelay === null || minDelay > item.delay) {
        minDelay = item.delay;
        results = [item];
      } else if (minDelay === item.delay) {
        results.push(item);
      }
    });

    return [results, minDelay];
  }

  #setSchedule() {
    const delay = this.#refreshRestTime();
    Promise.resolve().then(() => {
      this.#timer.set(() => {
        this.#resolveTask();
      }, delay);
    });
  }

  #resolveTask() {
    const [results] = this.#getClosestTasks();
    results.forEach(task => {
      this.#queue.delete(task);
      task.run();
    });
    if (this.#queue.size) {
      this.#setSchedule();
    }
  }
}

const $$log = (...msg) => console.log(new Date().toTimeString(), ...msg);
const queue = new DelayQueue();

const start = Date.now();
$$log(1);
setTimeout(() => {
  queue.add(() => $$log('1000ms', Date.now() - start), 1000);
}, 0);
setTimeout(() => {
  queue.add(() => $$log('1500ms', Date.now() - start), 1000);
}, 500);
setTimeout(() => {
  queue.add(() => $$log('1500ms', Date.now() - start), 500);
}, 1000);
setTimeout(() => {
  queue.add(() => $$log('800ms', Date.now() - start), 500);
}, 300);
setTimeout(() => {
  queue.add(() => $$log('3100ms', Date.now() - start), 100);
}, 3000);
setTimeout(() => {
  queue.add(() => $$log('2600ms', Date.now() - start), 2500);
}, 100);
setTimeout(() => {
  queue.add(() => $$log('1000ms', Date.now() - start), 500);
}, 500);
