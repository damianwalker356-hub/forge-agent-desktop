t = (1, 2, 3)
print(t, t[0], t[-1], len(t), t[1:], (5,), (), 1,)
a, b = 3, 4
print(a, b, (a, b) == (3, 4), (a, b) == [3, 4], [3, 4] == [3, 4], (1, 2) < (1, 3), [2] > [1, 9])
d = {}
d[(1, 2)] = "x"
print(d, d[(1, 2)], (1, 2) in d, (2, 1) in d)
for x, y in [(1, 2), (3, 4)]:
    print(x + y)
print(t + (4,), t * 2, 2 * t, 3 in t, 9 not in t, bool(()), bool((0,)))
print([(i, i * i) for i in range(4)])
try_it = 0
