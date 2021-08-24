# 跨域到底是怎么回事-CORS 详解

## CORS(Cross-Origin Resource Sharing)

很多人可能会混淆，觉得 CORS 是安全协议之类的，其实不然，[CORS](https://developer.mozilla.org/en-US/docs/Glossary/CORS)（Cross-Origin Resource Sharing，跨域资源共享）其实是一个系统，由一些列 HTTP headers 组成，这些 HTTP headers 决定了浏览器是否阻止前端 js 代码获取跨域请求的响应。就是一种提供给服务端，让其绕过 **SOP（Same-origin policy，同源策略）**，允许跨域请求访问到它的资源的方法，因为**同源策略**是已经默认阻止了跨域请求响应。

[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)机制使 web 应用能进行跨域资源共享，使得跨源数据传输得以安全传输。

### CORS 相关 headers

- `Origin`: 指请求发起方域
- `Access-Control-Request-Headers`：用于预检请求，告知服务器实际请求会有哪些自定义头部字段
- `Access-Control-Request-Method`：用于预检请求，告知服务器实际请求会使用哪一种方法
- `Access-Control-Allow-Origin`：指请求资源允许跟哪些域共享
- `Access-Control-Allow-Credentials`：指是否允许浏览器发送包含凭据的请求
- `Access-Control-Allow-Headers`：指实际请求允许使用的自定义请求头
- `Access-Control-Allow-Methods`：指实际请求允许使用的请求方法
- `Access-Control-Expose-Headers`：指允许 js 获取的响应头部中的字段
- `Access-Control-Max-Age`：指预检请求的结果在多少秒内有效

## 跨域请求的过程

在讲 CORS 前，其实需要先了解整个跨域请求的过程是怎样的。而跨域请求又可以分为简单请求和非简单请求，下面我们先详细说说这两者的异同

### 简单请求

当你的请求完全符合以下所有条件，即视为简单请求：

- 请求 methods 为 GET 、 POST、 HEAD 之一
- 请求头中，除了自动设置的字段（如 `Connection`、`User-Agent` 等）外，可人为配置的请求头只包含 `Accept`、`Accept-Language`、`Content-Language`、`Content-Type`
- 请求头中，`Content-Type` 只能是 `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` 之一

如果你发出的请求被浏览器定义为简单请求（因 WebKit Nightly 和 Safari Technology Preview 都对部分 headers 字段增加了额外限制，非规范的一部分），则你本次请求就不会发送**预检请求（Preflight Request）**，所以请求会成功发送并到达服务器，服务将对其做自己的判断并响应，如果响应头中不包含**Access-Control-Allow-Origin**或者该属性值不包含当前域名，则会被**阻止获取响应内容**

```javascript
const express = require('express');
const app = express();

app.post('/info', (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  console.log('post info');
  res.end('post');
});
```

可以在本地起一个简单的服务看到，这次请求是能切实到达服务器的，只是浏览器阻止了 js 对响应的获取。

### 非简单请求（复杂请求）

当你发送的请求不符合简单请求时，就会视为非简单请求。非简单请求将会在真正请求发送前，发送一条**预检请求（Preflight Request）**，目的是获取服务器对该次跨域请求是否允许的前置判断。

![预检请求](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-preflight-request.png)

预检请求将会是 OPTIONS 方法，在请求头上会带上**Access-Control-Request-Method**告知服务器本次实际请求的方法，以及**Access-Control-Request-Headers**告知服务器本次实际请求包含的自定义头部字段，然后由服务器决定该实际请求是否被允许。

浏览器端：

```javascript
// browser
fetch('http://192.168.153.230:9999/info', {
  method: 'post',
  headers: {
    aab: 'aab',
  },
});
```

服务端：

```javascript
// server
const express = require('express');
const app = express();

app.options('/info', (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader(
    'access-control-allow-headers',
    req.headers['access-control-request-headers'] || ''
  );
  console.log('options');
  res.sendStatus(204);
});

app.post('/info', (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  console.log('post info');
  res.end('post');
});
```

可以在本地起一个服务去发送次请求，带上一个自定义头部（aab），然后能查看 devtool 中的 network：

![预检请求](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-options.jpg)

可以看到的是，我们即使在 post 响应中，不返回`access-control-allow-headers`，只在 options 响应中返回，该跨域请求也是可以成功获取响应的。但是如果 options 响应中缺失`access-control-allow-origin`，则真实请求则**不会发出**；如果是真实请求响应中缺失`access-control-allow-origin`，则该请求**无法获取响应**。

所以预检请求必须返回正确的`access-control-allow-origin`、`access-control-allow-headers`、`access-control-allow-methods`，本次真实请求才能被发出。而真实请求必须返回正确的`access-control-allow-origin`，该请求才能被获取响应。

综上可知，跨域请求中如果是简单请求则**拦截响应**，非简单请求则是有可能**拦截请求**或者**拦截响应**。

## 设置预检请求缓存

要知道，每次非简单的跨域请求都会发送一次预检请求，而业务中很常见的就是 post 一个 json 数据，那多次请求的话，服务器也需要校验，多多少少还是增加了服务压力。

这时候可以在响应头上设置**access-control-max-age**，值是秒数

```javascript
app.options('/info', (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader(
    'access-control-allow-headers',
    req.headers['access-control-request-headers'] || ''
  );
  res.setHeader('access-control-max-age', 60);
  console.log('options');
  res.sendStatus(204);
});
```

那么在设置的时间内，同样的资源请求将不再发送预检请求，减少了服务压力。

![预检请求缓存](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-max-age.png)

## 包含凭据的跨域请求

跨域请求中，默认是不会带上身份凭据(cookies)的，而真实业务中往往需要上传 cookie 验证，这时候你可能会在 `XMLHttpRequest`中加上`withCredentials = true`，获取`fetch`中加上`credentials: 'include'`，然后你会得到其中一条报错：

- `The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'. The credentials mode of requests initiated by the XMLHttpRequest is controlled by the withCredentials attribute.`
- `Response to preflight request doesn't pass access control check: The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'. `

这时候我们需要将**access-control-allow-credentials**设置为`'true'`，再试一次，获得了另一个报错：

`The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'. The credentials mode of requests initiated by the XMLHttpRequest is controlled by the withCredentials attribute`

这是因为当**access-control-allow-credentials**为`'true'`时，**access-control-allow-origin**将必须为正确的请求发起 url，不能为\*。所以这时候将**access-control-allow-origin**返回请求时的 origin 即可。

这时候就能将 cookie 提交了。

![cookie](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-cookie.png)

## 获取自定义 header

在响应头上，可能会带有服务端返回的字段，这些字段默认是不允许 js 读取的，但是如果需要怎么办呢。也是需要在响应头上加入**access-control-expose-headers**，该属性能定义哪些响应头字段允许被 js 读取。

```javascript
app.post('/info', (req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-expose-headers', 'abc');
  res.setHeader('abc', '123');
  console.log('post info');
  res.end('post');
});
```

![headers](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-expose-headers.jpg)

这样，就能在 js 中获取允许导出的头部字段了

## 跨域请求缓存问题

最后说一种比较特殊的情况，就是有这么一个场景：有一个上传图片的功能，上传后显示预览效果（img 标签显示），然后图片又要能编辑，编辑就需要 js 请求加载，这时候你会发现请求报出了跨域。

![请求缓存跨域](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-image-cache.jpg)

明明添加了`access-control-allow-origin`，为什么还是报了跨域错误呢？其实这里的问题出现在，大部分的服务都是请求时头部如果没`Origin`字段，是不会返回`access-control-allow-origin`的，而图片的服务恰好都是强缓存，这时候因为 img 标签显示是没有跨域问题，也不会添加`Origin`字段

![img标签请求](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/cors-img.jpg)

而响应头又没有`access-control-allow-origin`，而恰好又被缓存了，这时候再请求同资源，浏览器将优先获取缓存，而因为缓存中的响应头没添加 CORS 相关头部，所以就报了跨域错误。

该如何解决呢，其实有三种方案：

- 1、给请求添加 search 参数，即给请求添加了任意一个`?v=123`之类的参数字段，这样请求将会重新发出不用缓存
- 2、给`img`标签添加`crossorigin`属性，这样浏览器对该图片的请求会带上`Origin`
- 3、给响应头加入 Vary 字段，该属性用于决定后续请求需要匹配哪些信息才能使用缓存。例如`Vary: Origin`，则后续请求如果`Origin`字段不一致则不使用请求，当然你也可以设置成`Vary: *`，但是这样用`Cache-Control`控制会更直观。

## 总结

至此，你应该也对 CORS 有个深入的了解了，但是浏览器的跨域安全管理仅仅如此吗？
