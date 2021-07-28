let mix = require('laravel-mix');

mix.webpackConfig({
    target: 'electron-main'
});


mix.js('src/app.js', 'dist');
mix.js('src/index.js', 'dist');
mix.postCss("src/app.css", "dist", [
    require("tailwindcss"),
]);
