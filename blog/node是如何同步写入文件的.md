# node 是如何同步写入文件的

最近在知乎上被邀请了一个问题，觉得比较有趣就试着回答了一下。

众所周知，nodejs 的 io 是非阻塞模型，但是还提供了同步接口，这一点确实有趣，那到底是怎么实现这些文件写入的呢？

**以下的源码都是基于 node 16.17.0**

## node 部分

我们知道 fs 中写入文件的 api: `writeFile`和`writeFileSync`，那他们到底做了什么呢，我们可以先看源码：[都在这](https://github.com/nodejs/node/blob/main/lib/fs.js)

```javascript
/**
 * Asynchronously writes data to the file.
 * @param {string | Buffer | URL | number} path
 * @param {string | Buffer | TypedArray | DataView | object} data
 * @param {{
 *   encoding?: string | null;
 *   mode?: number;
 *   flag?: string;
 *   signal?: AbortSignal;
 *   } | string} [options]
 * @param {(err?: Error) => any} callback
 * @returns {void}
 */
function writeFile(path, data, options, callback) {
  callback = maybeCallback(callback || options);
  options = getOptions(options, { encoding: 'utf8', mode: 0o666, flag: 'w' });
  const flag = options.flag || 'w';

  if (!isArrayBufferView(data)) {
    validateStringAfterArrayBufferView(data, 'data');
    if (typeof data !== 'string') {
      showStringCoercionDeprecation();
    }
    data = Buffer.from(String(data), options.encoding || 'utf8');
  }

  if (isFd(path)) {
    const isUserFd = true;
    const signal = options.signal;
    writeAll(path, isUserFd, data, 0, data.byteLength, signal, callback);
    return;
  }

  if (checkAborted(options.signal, callback)) return;

  fs.open(path, flag, options.mode, (openErr, fd) => {
    if (openErr) {
      callback(openErr);
    } else {
      const isUserFd = false;
      const signal = options.signal;
      writeAll(fd, isUserFd, data, 0, data.byteLength, signal, callback);
    }
  });
}

/**
 * Synchronously writes data to the file.
 * @param {string | Buffer | URL | number} path
 * @param {string | Buffer | TypedArray | DataView | object} data
 * @param {{
 *   encoding?: string | null;
 *   mode?: number;
 *   flag?: string;
 *   } | string} [options]
 * @returns {void}
 */
function writeFileSync(path, data, options) {
  options = getOptions(options, { encoding: 'utf8', mode: 0o666, flag: 'w' });

  if (!isArrayBufferView(data)) {
    validateStringAfterArrayBufferView(data, 'data');
    if (typeof data !== 'string') {
      showStringCoercionDeprecation();
    }
    data = Buffer.from(String(data), options.encoding || 'utf8');
  }

  const flag = options.flag || 'w';

  const isUserFd = isFd(path); // File descriptor ownership
  const fd = isUserFd ? path : fs.openSync(path, flag, options.mode);

  let offset = 0;
  let length = data.byteLength;
  try {
    while (length > 0) {
      const written = fs.writeSync(fd, data, offset, length);
      offset += written;
      length -= written;
    }
  } finally {
    if (!isUserFd) fs.closeSync(fd);
  }
}

function writeAll(fd, isUserFd, buffer, offset, length, signal, callback) {
  if (signal?.aborted) {
    const abortError = new AbortError(undefined, { cause: signal?.reason });
    if (isUserFd) {
      callback(abortError);
    } else {
      fs.close(fd, err => {
        callback(aggregateTwoErrors(err, abortError));
      });
    }
    return;
  }
  // write(fd, buffer, offset, length, position, callback)
  fs.write(fd, buffer, offset, length, null, (writeErr, written) => {
    if (writeErr) {
      if (isUserFd) {
        callback(writeErr);
      } else {
        fs.close(fd, err => {
          callback(aggregateTwoErrors(err, writeErr));
        });
      }
    } else if (written === length) {
      if (isUserFd) {
        callback(null);
      } else {
        fs.close(fd, callback);
      }
    } else {
      offset += written;
      length -= written;
      writeAll(fd, isUserFd, buffer, offset, length, signal, callback);
    }
  });
}
```

可以看到 `writFileSync` 中实际上是调用 `writeSync`，而 `writeFile` 内部调用了异步 `open` 里面用了一个递归函数 `writeAll`，最终是调用 `write` 函数。

然后再看看 [write](https://github.com/nodejs/node/blob/main/lib/fs.js#L822) 和 [writeSync](https://github.com/nodejs/node/blob/main/lib/fs.js#L897)

```javascript
/**
 * Writes `buffer` to the specified `fd` (file descriptor).
 * @param {number} fd
 * @param {Buffer | TypedArray | DataView | string | object} buffer
 * @param {number | object} [offsetOrOptions]
 * @param {number} [length]
 * @param {number | null} [position]
 * @param {(
 *   err?: Error,
 *   bytesWritten?: number;
 *   buffer?: Buffer | TypedArray | DataView
 *   ) => any} callback
 * @returns {void}
 */
function write(fd, buffer, offsetOrOptions, length, position, callback) {
  function wrapper(err, written) {
    // Retain a reference to buffer so that it can't be GC'ed too soon.
    callback(err, written || 0, buffer);
  }

  fd = getValidatedFd(fd);

  let offset = offsetOrOptions;
  if (isArrayBufferView(buffer)) {
    callback = maybeCallback(callback || position || length || offset);

    if (typeof offset === 'object') {
      ({
        offset = 0,
        length = buffer.byteLength - offset,
        position = null,
      } = offsetOrOptions ?? kEmptyObject);
    }

    if (offset == null || typeof offset === 'function') {
      offset = 0;
    } else {
      validateInteger(offset, 'offset', 0);
    }
    if (typeof length !== 'number') length = buffer.byteLength - offset;
    if (typeof position !== 'number') position = null;
    validateOffsetLengthWrite(offset, length, buffer.byteLength);

    const req = new FSReqCallback();
    req.oncomplete = wrapper;
    return binding.writeBuffer(fd, buffer, offset, length, position, req);
  }

  validateStringAfterArrayBufferView(buffer, 'buffer');
  if (typeof buffer !== 'string') {
    showStringCoercionDeprecation();
  }

  if (typeof position !== 'function') {
    if (typeof offset === 'function') {
      position = offset;
      offset = null;
    } else {
      position = length;
    }
    length = 'utf8';
  }

  const str = String(buffer);
  validateEncoding(str, length);
  callback = maybeCallback(position);

  const req = new FSReqCallback();
  req.oncomplete = wrapper;
  return binding.writeString(fd, str, offset, length, req);
}

ObjectDefineProperty(write, kCustomPromisifyArgsSymbol, {
  __proto__: null,
  value: ['bytesWritten', 'buffer'],
  enumerable: false,
});

/**
 * Synchronously writes `buffer` to the
 * specified `fd` (file descriptor).
 * @param {number} fd
 * @param {Buffer | TypedArray | DataView | string} buffer
 * @param {{
 *   offset?: number;
 *   length?: number;
 *   position?: number | null;
 *   }} [offsetOrOptions]
 * @returns {number}
 */
function writeSync(fd, buffer, offsetOrOptions, length, position) {
  fd = getValidatedFd(fd);
  const ctx = {};
  let result;

  let offset = offsetOrOptions;
  if (isArrayBufferView(buffer)) {
    if (typeof offset === 'object') {
      ({
        offset = 0,
        length = buffer.byteLength - offset,
        position = null,
      } = offsetOrOptions ?? kEmptyObject);
    }
    if (position === undefined) position = null;
    if (offset == null) {
      offset = 0;
    } else {
      validateInteger(offset, 'offset', 0);
    }
    if (typeof length !== 'number') length = buffer.byteLength - offset;
    validateOffsetLengthWrite(offset, length, buffer.byteLength);
    result = binding.writeBuffer(
      fd,
      buffer,
      offset,
      length,
      position,
      undefined,
      ctx
    );
  } else {
    validatePrimitiveStringAfterArrayBufferView(buffer, 'buffer');
    validateEncoding(buffer, length);

    if (offset === undefined) offset = null;
    result = binding.writeString(fd, buffer, offset, length, undefined, ctx);
  }
  handleErrorFromBinding(ctx);
  return result;
}
```

其实最终都是调用 `binding.writeBuffer` 和 `binding.writeString`，区别在于参数，在异步 `wirte` 中实际上多了一个请求回调对象，而这个请求对象是由 c++模块导出，[这个可以先了解一下](https://github.com/nodejs/node/blob/main/src/node_file.cc#L606)

```javascript
const req = new FSReqCallback();
req.oncomplete = wrapper;
```

以同步调用的 `writeSync` 为例子，`writeBuffer` 和 `writeString` 的第六、第五个参数是 undefined；而 `write` 中，`writeBuffer` 就把 `req` 传进了第六个参数中，这里是一个细节

![一个细节](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/node-io-details.jpeg)

到这里为止，都是 js 范畴

然后也应该清楚 `writeFile`、`writeFileSync` 内部调用 `write`、`writeFile`，而他们最终其实调用了 `binding.writeBuffer` 或者 `binding.writeString`。

而`binding` 是 js 和 c++中间的桥梁，用于给 js 上层提供 api，所以下面就开始 c++模块部分了。

## C++ 部分

在 [node_file.cc](https://github.com/nodejs/node/blob/main/src/node_file.cc#L2462) 中定义对外的 api 命名

```cpp
  SetMethod(context, target, "writeBuffer", WriteBuffer);
  SetMethod(context, target, "writeString", WriteString);
```

在 [writeBuffer](https://github.com/nodejs/node/blob/main/src/node_file.cc#L1802) 中，判断了第 6 个参数请求回调对象是否存在决定是否异步

```cpp
static void WriteBuffer(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  const int argc = args.Length();
  CHECK_GE(argc, 4);

  CHECK(args[0]->IsInt32());
  const int fd = args[0].As<Int32>()->Value();

  CHECK(Buffer::HasInstance(args[1]));
  Local<Object> buffer_obj = args[1].As<Object>();
  char* buffer_data = Buffer::Data(buffer_obj);
  size_t buffer_length = Buffer::Length(buffer_obj);

  CHECK(IsSafeJsInt(args[2]));
  const int64_t off_64 = args[2].As<Integer>()->Value();
  CHECK_GE(off_64, 0);
  CHECK_LE(static_cast<uint64_t>(off_64), buffer_length);
  const size_t off = static_cast<size_t>(off_64);

  CHECK(args[3]->IsInt32());
  const size_t len = static_cast<size_t>(args[3].As<Int32>()->Value());
  CHECK(Buffer::IsWithinBounds(off, len, buffer_length));
  CHECK_LE(len, buffer_length);
  CHECK_GE(off + len, off);

  const int64_t pos = GetOffset(args[4]);

  char* buf = buffer_data + off;
  uv_buf_t uvbuf = uv_buf_init(buf, len);

  FSReqBase* req_wrap_async = GetReqWrap(args, 5);
  if (req_wrap_async != nullptr) {  // write(fd, buffer, off, len, pos, req)
    AsyncCall(env, req_wrap_async, args, "write", UTF8, AfterInteger,
              uv_fs_write, fd, &uvbuf, 1, pos);
  } else {  // write(fd, buffer, off, len, pos, undefined, ctx)
    CHECK_EQ(argc, 7);
    FSReqWrapSync req_wrap_sync;
    FS_SYNC_TRACE_BEGIN(write);
    int bytesWritten = SyncCall(env, args[6], &req_wrap_sync, "write",
                                uv_fs_write, fd, &uvbuf, 1, pos);
    FS_SYNC_TRACE_END(write, "bytesWritten", bytesWritten);
    args.GetReturnValue().Set(bytesWritten);
  }
}
```

[writeString](https://github.com/nodejs/node/blob/main/src/node_file.cc#L1902) 则判断了第五个参数请求回调对象是否存在，而确定是否用异步

```cpp
static void WriteString(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  const int argc = args.Length();
  CHECK_GE(argc, 4);

  CHECK(args[0]->IsInt32());
  const int fd = args[0].As<Int32>()->Value();

  const int64_t pos = GetOffset(args[2]);

  const auto enc = ParseEncoding(isolate, args[3], UTF8);

  Local<Value> value = args[1];
  char* buf = nullptr;
  size_t len;

  FSReqBase* req_wrap_async = GetReqWrap(args, 4);
  const bool is_async = req_wrap_async != nullptr;

  // Avoid copying the string when it is externalized but only when:
  // 1. The target encoding is compatible with the string's encoding, and
  // 2. The write is synchronous, otherwise the string might get neutered
  //    while the request is in flight, and
  // 3. For UCS2, when the host system is little-endian.  Big-endian systems
  //    need to call StringBytes::Write() to ensure proper byte swapping.
  // The const_casts are conceptually sound: memory is read but not written.
  if (!is_async && value->IsString()) {
    auto string = value.As<String>();
    if ((enc == ASCII || enc == LATIN1) && string->IsExternalOneByte()) {
      auto ext = string->GetExternalOneByteStringResource();
      buf = const_cast<char*>(ext->data());
      len = ext->length();
    } else if (enc == UCS2 && IsLittleEndian() && string->IsExternalTwoByte()) {
      auto ext = string->GetExternalStringResource();
      buf = reinterpret_cast<char*>(const_cast<uint16_t*>(ext->data()));
      len = ext->length() * sizeof(*ext->data());
    }
  }

  if (is_async) {  // write(fd, string, pos, enc, req)
    CHECK_NOT_NULL(req_wrap_async);
    if (!StringBytes::StorageSize(isolate, value, enc).To(&len)) return;
    FSReqBase::FSReqBuffer& stack_buffer =
        req_wrap_async->Init("write", len, enc);
    // StorageSize may return too large a char, so correct the actual length
    // by the write size
    len = StringBytes::Write(isolate, *stack_buffer, len, args[1], enc);
    stack_buffer.SetLengthAndZeroTerminate(len);
    uv_buf_t uvbuf = uv_buf_init(*stack_buffer, len);
    int err = req_wrap_async->Dispatch(uv_fs_write,
                                       fd,
                                       &uvbuf,
                                       1,
                                       pos,
                                       AfterInteger);
    if (err < 0) {
      uv_fs_t* uv_req = req_wrap_async->req();
      uv_req->result = err;
      uv_req->path = nullptr;
      AfterInteger(uv_req);  // after may delete req_wrap_async if there is
                             // an error
    } else {
      req_wrap_async->SetReturnValue(args);
    }
  } else {  // write(fd, string, pos, enc, undefined, ctx)
    CHECK_EQ(argc, 6);
    FSReqWrapSync req_wrap_sync;
    FSReqBase::FSReqBuffer stack_buffer;
    if (buf == nullptr) {
      if (!StringBytes::StorageSize(isolate, value, enc).To(&len))
        return;
      stack_buffer.AllocateSufficientStorage(len + 1);
      // StorageSize may return too large a char, so correct the actual length
      // by the write size
      len = StringBytes::Write(isolate, *stack_buffer,
                               len, args[1], enc);
      stack_buffer.SetLengthAndZeroTerminate(len);
      buf = *stack_buffer;
    }
    uv_buf_t uvbuf = uv_buf_init(buf, len);
    FS_SYNC_TRACE_BEGIN(write);
    int bytesWritten = SyncCall(env, args[5], &req_wrap_sync, "write",
                                uv_fs_write, fd, &uvbuf, 1, pos);
    FS_SYNC_TRACE_END(write, "bytesWritten", bytesWritten);
    args.GetReturnValue().Set(bytesWritten);
  }
}
```

也就是说在 fs 模块中，用回调函数是否存在判断了本次调用是异步还是同步，然后分别调用 AsyncCall 和 SyncCall。后面我们可以看看这两个是什么：

SyncCall:

```cpp
template <typename Func, typename... Args>
int SyncCall(Environment* env, v8::Local<v8::Value> ctx,
             FSReqWrapSync* req_wrap, const char* syscall,
             Func fn, Args... args) {
  env->PrintSyncTrace();
  int err = fn(env->event_loop(), &(req_wrap->req), args..., nullptr);
  if (err < 0) {
    v8::Local<v8::Context> context = env->context();
    v8::Local<v8::Object> ctx_obj = ctx.As<v8::Object>();
    v8::Isolate* isolate = env->isolate();
    ctx_obj->Set(context,
                 env->errno_string(),
                 v8::Integer::New(isolate, err)).Check();
    ctx_obj->Set(context,
                 env->syscall_string(),
                 OneByteString(isolate, syscall)).Check();
  }
  return err;
}
```

AsyncCall:

```cpp
template <typename Func, typename... Args>
FSReqBase* AsyncDestCall(Environment* env, FSReqBase* req_wrap,
                         const v8::FunctionCallbackInfo<v8::Value>& args,
                         const char* syscall, const char* dest,
                         size_t len, enum encoding enc, uv_fs_cb after,
                         Func fn, Args... fn_args) {
  CHECK_NOT_NULL(req_wrap);
  req_wrap->Init(syscall, dest, len, enc);
  int err = req_wrap->Dispatch(fn, fn_args..., after);
  if (err < 0) {
    uv_fs_t* uv_req = req_wrap->req();
    uv_req->result = err;
    uv_req->path = nullptr;
    after(uv_req);  // after may delete req_wrap if there is an error
    req_wrap = nullptr;
  } else {
    req_wrap->SetReturnValue(args);
  }

  return req_wrap;
}

// Returns nullptr if the operation fails from the start.
template <typename Func, typename... Args>
FSReqBase* AsyncCall(Environment* env,
                     FSReqBase* req_wrap,
                     const v8::FunctionCallbackInfo<v8::Value>& args,
                     const char* syscall, enum encoding enc,
                     uv_fs_cb after, Func fn, Args... fn_args) {
  return AsyncDestCall(env, req_wrap, args,
                       syscall, nullptr, 0, enc,
                       after, fn, fn_args...);
}
```

注意这里有个细节，在 `SyncCall` 中，会给 fn 的最后一个参数传入 `nullptr`，`AsyncCall` 则不会。

![又是一个细节](https://raw.githubusercontent.com/ben-lau/blog/master/assets/images/node-io-another-details.jpeg)

而回到上面 `writeString` 和 `writeBuffer` 中，最终无论异步同步都是调用 `libuv`（这个是 node 的 io 库先不展开说了）的 `uv_fs_write`，只是根据 req 而分别使用 `AsyncCall` 和 `SyncCall` 去调用而已。

下面我们看看 libuv 中的 [uv_fs_write](https://github.com/nodejs/node/blob/main/deps/uv/src/unix/fs.c#L2152)：

```cpp
int uv_fs_write(uv_loop_t* loop,
                uv_fs_t* req,
                uv_file file,
                const uv_buf_t bufs[],
                unsigned int nbufs,
                int64_t off,
                uv_fs_cb cb) {
  INIT(WRITE);

  if (bufs == NULL || nbufs == 0)
    return UV_EINVAL;

  req->file = file;

  req->nbufs = nbufs;
  req->bufs = req->bufsml;
  if (nbufs > ARRAY_SIZE(req->bufsml))
    req->bufs = uv__malloc(nbufs * sizeof(*bufs));

  if (req->bufs == NULL)
    return UV_ENOMEM;

  memcpy(req->bufs, bufs, nbufs * sizeof(*bufs));

  req->off = off;
  POST;
}
```

这里的 cb 即为上方的回调函数，这里最终调用 POST，我们先看看 POST

```cpp
#define POST                                                                  \
  do {                                                                        \
    if (cb != NULL) {                                                         \
      uv__req_register(loop, req);                                            \
      uv__work_submit(loop,                                                   \
                      &req->work_req,                                         \
                      UV__WORK_FAST_IO,                                       \
                      uv__fs_work,                                            \
                      uv__fs_done);                                           \
      return 0;                                                               \
    }                                                                         \
    else {                                                                    \
      uv__fs_work(&req->work_req);                                            \
      return req->result;                                                     \
    }                                                                         \
  }                                                                           \
  while (0)
```

这里的 cb 就是前面说的细节： `SyncCall` 会给最后一个参数传入 `nullptr`，最终就是在这里利用回调函数判断同步异步

但是这里突然冒出来几个函数：

- [uv\_\_fs_work](https://github.com/nodejs/node/blob/main/deps/uv/src/unix/fs.c#L1683) 是处理文件 io 的函数：

```cpp
static void uv__fs_work(struct uv__work* w) {
  int retry_on_eintr;
  uv_fs_t* req;
  ssize_t r;

  req = container_of(w, uv_fs_t, work_req);
  retry_on_eintr = !(req->fs_type == UV_FS_CLOSE ||
                     req->fs_type == UV_FS_READ);

  do {
    errno = 0;

#define X(type, action)                                                       \
  case UV_FS_ ## type:                                                        \
    r = action;                                                               \
    break;

    switch (req->fs_type) {
    X(ACCESS, access(req->path, req->flags));
    X(CHMOD, chmod(req->path, req->mode));
    X(CHOWN, chown(req->path, req->uid, req->gid));
    X(CLOSE, uv__fs_close(req->file));
    X(COPYFILE, uv__fs_copyfile(req));
    X(FCHMOD, fchmod(req->file, req->mode));
    X(FCHOWN, fchown(req->file, req->uid, req->gid));
    X(LCHOWN, lchown(req->path, req->uid, req->gid));
    X(FDATASYNC, uv__fs_fdatasync(req));
    X(FSTAT, uv__fs_fstat(req->file, &req->statbuf));
    X(FSYNC, uv__fs_fsync(req));
    X(FTRUNCATE, ftruncate(req->file, req->off));
    X(FUTIME, uv__fs_futime(req));
    X(LUTIME, uv__fs_lutime(req));
    X(LSTAT, uv__fs_lstat(req->path, &req->statbuf));
    X(LINK, link(req->path, req->new_path));
    X(MKDIR, mkdir(req->path, req->mode));
    X(MKDTEMP, uv__fs_mkdtemp(req));
    X(MKSTEMP, uv__fs_mkstemp(req));
    X(OPEN, uv__fs_open(req));
    X(READ, uv__fs_read(req));
    X(SCANDIR, uv__fs_scandir(req));
    X(OPENDIR, uv__fs_opendir(req));
    X(READDIR, uv__fs_readdir(req));
    X(CLOSEDIR, uv__fs_closedir(req));
    X(READLINK, uv__fs_readlink(req));
    X(REALPATH, uv__fs_realpath(req));
    X(RENAME, rename(req->path, req->new_path));
    X(RMDIR, rmdir(req->path));
    X(SENDFILE, uv__fs_sendfile(req));
    X(STAT, uv__fs_stat(req->path, &req->statbuf));
    X(STATFS, uv__fs_statfs(req));
    X(SYMLINK, symlink(req->path, req->new_path));
    X(UNLINK, unlink(req->path));
    X(UTIME, uv__fs_utime(req));
    X(WRITE, uv__fs_write_all(req));
    default: abort();
    }
#undef X
  } while (r == -1 && errno == EINTR && retry_on_eintr);

  if (r == -1)
    req->result = UV__ERR(errno);
  else
    req->result = r;

  if (r == 0 && (req->fs_type == UV_FS_STAT ||
                 req->fs_type == UV_FS_FSTAT ||
                 req->fs_type == UV_FS_LSTAT)) {
    req->ptr = &req->statbuf;
  }
}
```

- [uv\_\_work_submit](https://github.com/nodejs/node/blob/main/deps/uv/src/threadpool.c#L261) 是一个把工作函数（`uv__fs_work`）和完成回调（`uv__fs_done`）加入 `uv__work`结构中，并利用 `post` 交给线程池，执行一次线程操作的函数

```cpp
void uv__work_submit(uv_loop_t* loop,
                     struct uv__work* w,
                     enum uv__work_kind kind,
                     void (*work)(struct uv__work* w),
                     void (*done)(struct uv__work* w, int status)) {
  uv_once(&once, init_once);
  w->loop = loop;
  w->work = work;
  w->done = done;
  post(&w->wq, kind);
}
```

这里简单介绍一下这里的 [post](https://github.com/nodejs/node/blob/main/deps/uv/src/threadpool.c#L142)，他把 `uv__work` 加入进了 `wq` 链表的表尾，而 `wq` 是个全局静态变量，进程空间里的所有线程都能读取这个链表。加入之后他通过 `uv_cond_signal`唤醒一个在等待的线程来处理这个任务，而线程会在 `wq` 中取出这个 `uv__work` 并执行，并在完成后通知主线程的 io 执行 cb。

```cpp
static void post(QUEUE* q, enum uv__work_kind kind) {
  uv_mutex_lock(&mutex);
  if (kind == UV__WORK_SLOW_IO) {
    /* Insert into a separate queue. */
    QUEUE_INSERT_TAIL(&slow_io_pending_wq, q);
    if (!QUEUE_EMPTY(&run_slow_work_message)) {
      /* Running slow I/O tasks is already scheduled => Nothing to do here.
         The worker that runs said other task will schedule this one as well. */
      uv_mutex_unlock(&mutex);
      return;
    }
    q = &run_slow_work_message;
  }

  QUEUE_INSERT_TAIL(&wq, q);
  if (idle_threads > 0)
    uv_cond_signal(&cond);
  uv_mutex_unlock(&mutex);
}
```

这里关乎 libuv 的线程池，就不展开太多了，可以理解为异步模式执行工作。

- [uv\_\_fs_done](https://github.com/nodejs/node/blob/main/deps/uv/src/unix/fs.c#L1755) 是异步 io 结束的回调了，最终调用 req->cb 即上面的 cb 函数

```cpp
static void uv__fs_done(struct uv__work* w, int status) {
  uv_fs_t* req;

  req = container_of(w, uv_fs_t, work_req);
  uv__req_unregister(req->loop, req);

  if (status == UV_ECANCELED) {
    assert(req->result == 0);
    req->result = UV_ECANCELED;
  }

  req->cb(req);
}
```

到这里基本就清晰了，我们回到 `POST` 中，这里使用 cb 是否存在判断该 io 操作是否异步，而 cb 存在时利用 `uv__work_submit` 把操作交给线程池；cb 不存在时就在当前线程（事件循环所在的）直接调用了。这里就是所谓的同步写入，也同时看出是如何异步写入文件的。
