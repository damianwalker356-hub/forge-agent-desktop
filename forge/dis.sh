#!/bin/bash
# usage: ./dis.sh "hex bytes..."  — disassemble a byte string
python3 -c "import sys;open('/tmp/d.bin','wb').write(bytes.fromhex(sys.argv[1].replace(' ','')))" "$1"
objdump -D -b binary -m i386:x86-64 /tmp/d.bin | tail -n +8
