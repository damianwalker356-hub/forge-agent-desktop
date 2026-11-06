# Symplectic-Euler orbit + piston kinematics, written in Forge's Python-like syntax.
import math

G = 6.674e-11
M = 5.972e24

def accel(x, y):
    r2 = x * x + y * y
    r = math.sqrt(r2)
    a = -G * M / r2
    return a * x / r, a * y / r

def orbit(steps, dt):
    x, y = 6771000.0, 0.0
    vx, vy = 0.0, 7672.0
    e_min, e_max = 1e300, -1e300
    for i in range(steps):
        ax, ay = accel(x, y)
        vx += ax * dt
        vy += ay * dt
        x += vx * dt
        y += vy * dt
        e = 0.5 * (vx * vx + vy * vy) - G * M / math.sqrt(x * x + y * y)
        e_min = min(e_min, e)
        e_max = max(e_max, e)
    return x, y, (e_max - e_min) / abs(e_min)

def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

def piston(rpm, stroke_mm, rod_mm, deg):
    r = stroke_mm / 2.0
    th = math.radians(deg)
    x = r * math.cos(th) + math.sqrt(rod_mm ** 2 - (r * math.sin(th)) ** 2)
    w = rpm * 2.0 * math.pi / 60.0
    v = -r * w * (math.sin(th) + r * math.sin(2 * th) / (2 * math.sqrt(rod_mm ** 2 - (r * math.sin(th)) ** 2)))
    return x, v / 1000.0

x, y, drift = orbit(2000, 1.0)
print(f"orbit: x={x:.1f} m  y={y:.1f} m  energy drift={drift:.2e}")
print("fib:", [fib(n) for n in range(15)] if False else [fib(n) for n in range(15)])
table = {}
for deg in range(0, 361, 90):
    pos, vel = piston(7000, 86.0, 143.0, deg)
    table[deg] = round(pos, 3)
    print("%4d deg  x=%8.3f mm  v=%7.2f m/s" % (deg, pos, vel))
print(table)
words = "the quick brown fox jumps over the lazy dog".split()
counts = {}
for w in words:
    counts[w] = counts.get(w, 0) + 1
print(sorted(counts.items()), max(words), len(counts))
s = 0
i = 0
while True:
    i += 1
    if i % 3 == 0:
        continue
    if i > 20:
        break
    s += i
print("sum", s, "ok" if 0 <= s < 1000 else "bad", 7 // 2, -7 // 2, 7 % -3, 2 ** 0.5, "abc"[-1], "hello"[1:3], [1, 2, 3][1:])
