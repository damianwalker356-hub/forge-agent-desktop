x = 3
y = 2.5
name = "forge"
print(f"{x} and {y} and {name}", f"{x + 1}", f"{y:.3f}", f"{name:>8}|", f"{x * y:08.2f}", f"{{literal}}", f"{name.upper()} {len(name)}", f"{[1, 2][0]}", f"{'quoted'}")
print(f"", f"plain", f"tab\there {x}{y}")
