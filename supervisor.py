"""Keeps the agent alive: restarts the server if it crashes (cross-platform). Run: python3 supervisor.py"""
import os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "data", "agent.log")
os.makedirs(os.path.dirname(LOG), exist_ok=True)
delay = 1
while True:
    started = time.time()
    with open(LOG, "a") as log:
        log.write("\n--- start %s ---\n" % time.ctime())
        p = subprocess.Popen([sys.executable, "-m", "agent.server"], cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
        try:
            code = p.wait()
        except KeyboardInterrupt:
            p.terminate()
            break
        log.write("exited with %s\n" % code)
    delay = 1 if time.time() - started > 60 else min(delay * 2, 30)
    time.sleep(delay)
