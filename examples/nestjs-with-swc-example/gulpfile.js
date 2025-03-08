/* eslint-disable @typescript-eslint/no-var-requires */

const gulp = require('gulp');
const ts = require('gulp-typescript');

const paths = {
  src: 'src/templates/**/*.tsx',
  dest: 'dist/templates/',
};

exports.default = function (cb) {
  gulp
    .src(paths.src, { sourcemaps: true })
    .pipe(ts({ noImplicitAny: true, jsx: 'react-jsx' }))
    .pipe(gulp.dest(paths.dest));

  cb();
};
