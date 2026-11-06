def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

def fact(n):
    r = 1
    i = 2
    while i <= n:
        r *= i
        i += 1
    return r

def classify(x):
    if x < 0:
        return "neg"
    elif x == 0:
        return "zero"
    elif x < 10:
        return "small"
    else:
        return "big"

total = 0
for i in range(10):
    if i % 2 == 0:
        continue
    total += i
    if total > 20:
        break
print(total, fib(20), fact(10), classify(-1), classify(0), classify(5), classify(50))

xs = [3, 1, 2]
xs[0] = 10
xs[1] += 5
d = {}
d["a"] = 1
d["a"] += 41
for k in d:
    print(k, d[k])
for i, v in [[1, "a"], [2, "b"]]:
    print(i, v)
sq = [x * x for x in range(6) if x % 2 == 1]
print(xs, d, sq, [c for c in "abc"])
a, b = 1, 2
a, b = b, a
print(a, b, (a, b), ())
s = 0
for ch in "hello":
    s += 1
print(s, "ll" in "hello", 3 in xs, 3 not in xs, None is None, 1 < 2 < 3, 1 < 3 < 2)
n = 0
while True:
    n += 1
    if n >= 5: break
print(n, 2 ** -1, 7 / 2, -7 % 3, 7 % -3, 1e3, 1.0 / 3)
assert n == 5
del d["a"]
print(d, len(xs), xs[-1], xs[::], xs[1:], xs[:2])
