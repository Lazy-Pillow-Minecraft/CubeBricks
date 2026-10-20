export function minimumTemplatePackingSide(rectangles, padding) {
  if (!rectangles.length) return 1;
  const dimensions = rectangles.map(entry => ({
    width: Math.max(1, entry.width) + padding,
    height: Math.max(1, entry.height) + padding
  }));
  const totalArea = dimensions.reduce((sum, entry) => sum + entry.width * entry.height, 0);
  return Math.max(
    Math.ceil(Math.sqrt(totalArea)),
    ...dimensions.map(entry => Math.max(entry.width, entry.height))
  );
}

export function packTemplateRectangles(rectangles, padding, fixedSide = null) {
  if (!rectangles.length) return { placements: new Map(), side: 1 };
  const sorted = [...rectangles].sort((left, right) => right.width * right.height - left.width * left.height
    || Math.max(right.width, right.height) - Math.max(left.width, left.height));
  const paddedWidth = entry => Math.max(1, entry.width) + padding;
  const paddedHeight = entry => Math.max(1, entry.height) + padding;
  const totalArea = sorted.reduce((sum, entry) => sum + paddedWidth(entry) * paddedHeight(entry), 0);
  const widest = Math.max(...sorted.map(paddedWidth));
  const tallest = Math.max(...sorted.map(paddedHeight));
  const totalWidth = sorted.reduce((sum, entry) => sum + paddedWidth(entry), 0);
  const lowerBound = Math.max(widest, tallest, Math.ceil(Math.sqrt(totalArea)));
  const upperBound = Math.max(totalWidth, tallest);

  const strategies = ['diagonal', 'area'];
  const packIntoSquare = (side, strategy) => {
    const freeRectangles = [{ x: 0, y: 0, width: side, height: side }];
    const placements = new Map();
    for (const entry of sorted) {
      const width = paddedWidth(entry), height = paddedHeight(entry);
      let choice = null;
      for (const free of freeRectangles) {
        if (width > free.width || height > free.height) continue;
        const areaWaste = free.width * free.height - width * height;
        const shortWaste = Math.min(free.width - width, free.height - height);
        const longWaste = Math.max(free.width - width, free.height - height);
        const scores = {
          area: [areaWaste, shortWaste, Math.max(free.x, free.y), free.y, free.x],
          'short-side': [shortWaste, longWaste, areaWaste, free.y, free.x],
          diagonal: [Math.max(free.x, free.y), free.x + free.y, areaWaste, shortWaste],
          'top-left': [free.y, free.x, areaWaste, shortWaste]
        };
        const score = scores[strategy];
        if (!choice || score.some((value, index) => value < choice.score[index]
          && score.slice(0, index).every((prior, priorIndex) => prior === choice.score[priorIndex]))) {
          choice = { free, score };
        }
      }
      if (!choice) return null;
      const used = { x: choice.free.x, y: choice.free.y, width, height };
      placements.set(entry, { x: used.x, y: used.y });
      const split = [];
      for (const free of freeRectangles) {
        const separated = used.x >= free.x + free.width || used.x + used.width <= free.x
          || used.y >= free.y + free.height || used.y + used.height <= free.y;
        if (separated) {
          split.push(free);
          continue;
        }
        if (used.x > free.x) split.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
        if (used.x + used.width < free.x + free.width) split.push({
          x: used.x + used.width, y: free.y,
          width: free.x + free.width - used.x - used.width, height: free.height
        });
        if (used.y > free.y) split.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
        if (used.y + used.height < free.y + free.height) split.push({
          x: free.x, y: used.y + used.height,
          width: free.width, height: free.y + free.height - used.y - used.height
        });
      }
      freeRectangles.length = 0;
      for (let index = 0; index < split.length; index++) {
        const candidate = split[index];
        if (candidate.width <= 0 || candidate.height <= 0) continue;
        const contained = split.some((other, otherIndex) => {
          if (otherIndex === index) return false;
          const inside = candidate.x >= other.x && candidate.y >= other.y
            && candidate.x + candidate.width <= other.x + other.width
            && candidate.y + candidate.height <= other.y + other.height;
          const identical = candidate.x === other.x && candidate.y === other.y
            && candidate.width === other.width && candidate.height === other.height;
          return inside && (!identical || otherIndex < index);
        });
        if (!contained) freeRectangles.push(candidate);
      }
    }
    const compactness = sorted.reduce((score, entry) => {
      const placement = placements.get(entry);
      const width = paddedWidth(entry), height = paddedHeight(entry);
      return score + (placement.y * side + placement.x) * width * height;
    }, 0);
    return { placements, side, score: side * side, compactness };
  };

  const packAtSide = side => {
    let preferred = null;
    for (const strategy of strategies) {
      const packed = packIntoSquare(side, strategy);
      if (packed && (!preferred || packed.compactness < preferred.compactness)) preferred = packed;
    }
    return preferred;
  };

  if (fixedSide !== null) return packAtSide(Math.max(lowerBound, Math.ceil(fixedSide)));

  let low = lowerBound, high = upperBound, best = packAtSide(high);
  while (low <= high) {
    const side = Math.floor((low + high) / 2);
    const packed = packAtSide(side);
    if (packed) {
      best = packed;
      high = side - 1;
    } else {
      low = side + 1;
    }
  }
  return best;
}
