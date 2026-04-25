#!/bin/bash
docker build -f Dockerfile.test -t sudoku-test .
docker run --rm sudoku-test