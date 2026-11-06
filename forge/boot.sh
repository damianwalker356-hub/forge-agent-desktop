#!/bin/sh
# usage: ./boot.sh program.forge
cd "$(dirname "$0")" && exec ./forge core.fg lang/rt.fg lang/fnum.fg lang/lex.fg lang/comp.fg lang/builtins.fg lang/boot.fg "$@"
