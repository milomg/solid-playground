import type { Tab } from './types';

const indexTSX = `import { render } from "solid-js/web";
import { createSignal } from "solid-js";

function Counter() {
  const [count, setCount] = createSignal(1);
  const increment = () => setCount(count => count + 1);

  return (
    <button type="button" onClick={increment}>
      {count()}
    </button>
  );
}

render(() => <Counter />, document.getElementById("app")!);
`;

const tsconfig = `{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowSyntheticDefaultImports": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`;

export const defaultTabs: Tab[] = [
  { name: 'tsconfig.json', source: tsconfig },
  { name: 'main.tsx', source: indexTSX },
];
