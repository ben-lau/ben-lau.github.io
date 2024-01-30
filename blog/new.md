## react 部分调用结论

<table>
  <tr style="background:#f1f1f1">
    <td></td>
    <td>同步>promise>setTimeout</td>
    <td>promise>同步>setTimeout</td>
    <td>promise>setTimeout>同步</td>
  </tr>
  <tr>
    <td style="background:#f1f1f1">同步mount</td>
    <td colspan="3">当timeout＜1ms时，promise和timeout合并更新；（函数组件中，同步和promise有几率合并）</td>
  </tr>
  <tr>
    <td style="background:#f1f1f1">promise mount</td>
    <td colspan="2">同步和promise合并更新</td>
    <td>当timeout＜1ms时，全合并更新，否则同步和promise合并更新</td>
  </tr>
  <tr>
    <td style="background:#f1f1f1">timeout mount</td>
    <td colspan="2">同步和promise合并更新</td>
    <td>当timeout＜1ms时，全合并更新，否则同步和promise合并更新</td>
  </tr>
  <tr>
    <td style="background:#f1f1f1">离散事件</td>
    <td>三块<strong>依次</strong>更新</td>
    <td colspan="2">同步和promise合并更新</td>
  </tr>
</table>

## resolve 方法中或者 then 回调函数中返回 thenable 对象

结论：
1、因为 resolve 或者 then 返回 thenable 对象，则新返回的 promise 对象需要等待内部的 thenable 完成后才能完成 (根本原因)
2、创建方法调用内部 thenable 对象，并推入 microtask 队列，具体函数为：（第一个 tick）

```javascript
() => {
  innerPromise.then((res, rej) => {
    resolvePromise(outterPromise, value, res, rej);
  });
};
```

3、调用这个函数后会等待 innerPromise 完成后将其 onfulfilled 函数推入 microtask 队列，即 (第二个 tick)

```javascript
(res, rej) => {
  resolvePromise(outterPromise, value, res, rej);
};
```

4、调用后会完成 outterPromise，这时候才会把 outterPromise 的 onfulfilled 函数推入 microtask 队列

### 示例及解释

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
// [()=>1,()=>2]
// [()=>p.then(()=>resolveWrapper),()=>3]
// [()=>resolveWrapper,()=>4]
// [()=>5,()=>6]

```

```javascript
new Promise(res => {
  res(
    Promise.resolve().then(() => {
      console.log(1);
    })
  );
}).then(() => {
  console.log(4);
});

Promise.resolve()
  .then(() => console.log(2))
  .then(() => console.log(3))
  .then(() => console.log(5))
  .then(() => console.log(6));
// [()=>{1},()=>p.then(()=>resolveWrapper),()=>2]
// [()=>resolveWrapper,()=>3]
// [()=>4,()=>5]
// [null,()=>6]
```