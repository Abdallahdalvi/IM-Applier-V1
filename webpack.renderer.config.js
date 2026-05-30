const rules = require('./webpack.rules').filter(rule => {
  if (rule.use && rule.use.loader === '@vercel/webpack-asset-relocator-loader') {
    return false;
  }
  return true;
});

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

module.exports = {
  // Put your normal webpack config below here
  module: {
    rules,
  },
};
