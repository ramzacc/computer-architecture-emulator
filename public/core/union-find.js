// Tiny union-find over arbitrary keys: nets, splitter bits, or port points.
// `union` always attaches the first root to the second so callers that build
// the same graph in the same order always get identical representatives.
export function createUnionFind() {
  const parent = new Map();
  const find = (item) => {
    let root = item;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root);
    let node = item;
    while (node !== root) {
      const next = parent.get(node);
      parent.set(node, root);
      node = next;
    }
    if (!parent.has(root)) parent.set(root, root);
    return root;
  };
  const union = (a, b) => {
    parent.set(find(a), find(b));
  };
  return { parent, find, union };
}
