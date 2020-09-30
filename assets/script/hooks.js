const { render, useState, useEffect } = (function () {
  const hooks = [];
  let cursor = 0;
  let component;
  const api = {
    render(_component) {
      component = component || _component;
      cursor = 0;
      component().render();
    },
    useState(initVal) {
      hooks[cursor] = hooks[cursor] || initVal;
      const _cursor = cursor;
      cursor++;
      const setState = _state => {
        hooks[_cursor] = _state;
        api.render();
      };
      return [hooks[_cursor], setState];
    },
    useEffect(cb, depArray) {
      hooks[cursor] = hooks[cursor] || {};
      const { deps, cleanup } = hooks[cursor];
      const hasChanged = deps
        ? !depArray.every((item, index) => item === deps[index])
        : true;
      if (hasChanged || !depArray) {
        typeof cleanup === 'function' && cleanup();
        hooks[cursor].cleanup = cb();
        hooks[cursor].deps = depArray;
      }
      cursor++;
    },
  };
  return api;
})();

const Counter = () => {
  const [count, setCount] = useState(1);
  const [text, setText] = useState(1);
  useEffect(() => {
    console.log('somethings Changed');
  });
  useEffect(() => {
    console.log('mount');
  }, []);
  useEffect(() => {
    console.log('count changed');
  }, [count]);
  useEffect(() => {
    console.log('text Changed');
  }, [text]);
  return {
    render() {
      const node = document.createElement('div');
      const CountNode = document.createElement('button');
      CountNode.onclick = () => setCount(count + 1);
      CountNode.innerText = `count is ${count}`;
      const TextNode = document.createElement('button');
      TextNode.onclick = () => setText(Math.random());
      TextNode.innerText = `text is ${text}`;
      node.appendChild(CountNode);
      node.appendChild(TextNode);
      refreshNode(node);
    },
  };
};

const refreshNode = node => {
  const root = document.getElementById('root1');
  root.firstChild && root.removeChild(root.firstChild);
  root.appendChild(node);
};

const element = document.createElement('div');
element.id = 'root1';
document.body.appendChild(element);
render(Counter);
