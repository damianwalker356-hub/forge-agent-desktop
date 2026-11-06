D = {"a": 1, "b": 2}
D["n"] = 5
del D["a"]
D["a"] = 7
print(D, list(D.keys()), list(D.items()))
E = {}
for i in range(40):
    E[i] = i * i
for i in range(0, 40, 3):
    del E[i]
E["last"] = True
print(E, len(E))
for k in E:
    print(k, end=" ")
print()
