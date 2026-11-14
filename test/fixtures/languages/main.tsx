import { useState } from "react";

function Counter() {
  const [count] = useState(0);
  return <span>{count}</span>;
}

export default () => <Counter />;
