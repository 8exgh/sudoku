'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

describe('generatePuzzle', () => {
    let dom;
    let generatePuzzle;

    before(async () => {
        dom = await JSDOM.fromFile(
            path.join(__dirname, '..', 'index.html'),
            { runScripts: 'dangerously', url: 'file:///' }
        );
        if (dom.window.document.readyState !== 'complete') {
            await new Promise(resolve => dom.window.addEventListener('load', resolve));
        }
        generatePuzzle = dom.window.generatePuzzle;
        assert.equal(typeof generatePuzzle, 'function', 'generatePuzzle not exposed on window');
    });

    // index.html's boot script starts a setInterval timer that would otherwise
    // keep Node's event loop alive forever. close() cancels it.
    after(() => dom.window.close());

    const countNonZero = (board) => board.flat().filter(v => v !== 0).length;

    it('returns { puzzle, solution } as 9x9 number arrays', () => {
        const { puzzle, solution } = generatePuzzle('easy');
        for (const board of [puzzle, solution]) {
            assert.equal(board.length, 9);
            for (const row of board) {
                assert.equal(row.length, 9);
                for (const cell of row) assert.equal(typeof cell, 'number');
            }
        }
    });

    it('produces a valid solution: rows, columns, and 3x3 boxes are permutations of 1..9', () => {
        const { solution } = generatePuzzle('medium');
        const isPerm = (arr) => {
            if (arr.length !== 9) return false;
            const s = new Set(arr);
            if (s.size !== 9) return false;
            for (let v = 1; v <= 9; v++) if (!s.has(v)) return false;
            return true;
        };

        for (let r = 0; r < 9; r++) {
            assert.ok(isPerm(solution[r]), `row ${r} is not a permutation of 1..9`);
        }
        for (let c = 0; c < 9; c++) {
            const col = [];
            for (let r = 0; r < 9; r++) col.push(solution[r][c]);
            assert.ok(isPerm(col), `column ${c} is not a permutation of 1..9`);
        }
        for (let br = 0; br < 3; br++) {
            for (let bc = 0; bc < 3; bc++) {
                const box = [];
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 3; c++) {
                        box.push(solution[br * 3 + r][bc * 3 + c]);
                    }
                }
                assert.ok(isPerm(box), `box (${br},${bc}) is not a permutation of 1..9`);
            }
        }
    });

    it('puzzle is a subset of solution: each non-zero cell matches solution', () => {
        const { puzzle, solution } = generatePuzzle('hard');
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const v = puzzle[r][c];
                if (v !== 0) {
                    assert.equal(v, solution[r][c],
                        `puzzle[${r}][${c}] (${v}) does not match solution (${solution[r][c]})`);
                }
            }
        }
    });

    it('clue count: easy has 42 clues', () => {
        assert.equal(countNonZero(generatePuzzle('easy').puzzle), 42);
    });

    it('clue count: medium has 32 clues', () => {
        assert.equal(countNonZero(generatePuzzle('medium').puzzle), 32);
    });

    it('clue count: hard has 26 clues', () => {
        assert.equal(countNonZero(generatePuzzle('hard').puzzle), 26);
    });

    it('clue count: unknown difficulty falls back to 40 clues', () => {
        assert.equal(countNonZero(generatePuzzle('silly').puzzle), 40);
    });

    it('solution contains no zeros', () => {
        const { solution } = generatePuzzle('easy');
        for (const row of solution) {
            for (const v of row) assert.notEqual(v, 0);
        }
    });
});
