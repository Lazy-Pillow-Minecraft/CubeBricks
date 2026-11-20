// Animation indexes groups without exposing or modifying their geometry,
// curve nodes or modifier nodes. Leaves ignore the shared collapse state.
export function animationOutlinerRows(project, collapsedGroups, filter, itemHeight, groupEndHeight) {
  const rows = [];
  const groups = new Map();
  const readGroup = uid => {
    if (groups.has(uid)) return groups.get(uid);
    const node = project.getNode(uid);
    if (node?.type !== 'group') return null;
    const children = node.children.map(child => project.getNode(child)).filter(Boolean);
    const entry = {
      node, children: children.filter(child => child.type === 'group').map(child => child.uid),
      hasLocator: children.some(child => child.type === 'locator')
    };
    groups.set(uid, entry);
    return entry;
  };
  const matches = new Map();
  const matching = uid => {
    if (matches.has(uid)) return matches.get(uid);
    const entry = readGroup(uid);
    if (!entry) return false;
    matches.set(uid, false);
    const match = !filter || entry.node.name.toLowerCase().includes(filter)
      || uid.toLowerCase().includes(filter) || entry.children.some(matching);
    matches.set(uid, match);
    return match;
  };
  const collect = (uid, depth = 0, ancestors = []) => {
    if (!matching(uid)) return;
    const { node, children, hasLocator } = readGroup(uid);
    const container = children.length > 0;
    const collapsed = container && collapsedGroups.has(uid);
    rows.push({
      node, depth, ancestors, group: true, curve: false, container, collapsed,
      hasCopyNodes: false, animationGroup: true, hasLocator, height: itemHeight
    });
    if (!container) return;
    if (!collapsed) for (const child of children) collect(child, depth + 1, [...ancestors, { uid, depth }]);
    rows.push({ groupEnd: true, groupUid: uid, depth, ancestors, height: groupEndHeight });
  };
  project.outliner.forEach(uid => collect(uid));
  return rows;
}
