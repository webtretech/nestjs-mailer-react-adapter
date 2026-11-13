/* eslint-disable @typescript-eslint/no-var-requires */

const gulp = require('gulp');
const ts = require('gulp-typescript');
const { pipeline } = require('node:stream');

const paths = {
  src: 'src/templates/**/*.tsx',
  dest: 'dist/templates/',
};

exports.default = function (cb) {
  pipeline(
    gulp.src(paths.src, { sourcemaps: true }),
    ts({ noImplicitAny: true, jsx: 'react-jsx' }),
    gulp.dest(paths.dest),
    cb,
  );
};
