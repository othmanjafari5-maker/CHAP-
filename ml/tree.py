"""Small deterministic decision tree shared by demo and candidate training."""
def impurity(data):
    if not data:
        return 0
    p = sum(r[-1] for r in data) / len(data)
    return len(data) * 2 * p * (1 - p)

def train(data, depth=0):
    leaf = {'positiveRate': sum(r[-1] for r in data) / len(data), 'samples': len(data)}
    if depth >= 4 or len(data) < 40:
        return leaf
    best = None
    for feature in range(6):
        values = sorted(set(r[feature + 1] for r in data))
        for threshold in values[::max(1, len(values) // 20)]:
            left = [r for r in data if r[feature + 1] <= threshold]
            right = [r for r in data if r[feature + 1] > threshold]
            if min(len(left), len(right)) < 15:
                continue
            loss = impurity(left) + impurity(right)
            if best is None or loss < best[0]:
                best = (loss, feature, threshold, left, right)
    if best is None or best[0] >= impurity(data):
        return leaf
    _, feature, threshold, left, right = best
    return {'feature': feature, 'threshold': threshold, 'left': train(left, depth + 1), 'right': train(right, depth + 1)}

