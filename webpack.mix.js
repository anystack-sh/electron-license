let mix = require('laravel-mix');

mix.webpackConfig({
    target: 'electron-main'
});

mix.copy('src/license.html', 'dist');
mix.js('src/license.js', 'dist');
// mix.js('src/index.js', 'dist');
mix.postCss("src/license.css", "dist", [
    require("tailwindcss"),
]);
