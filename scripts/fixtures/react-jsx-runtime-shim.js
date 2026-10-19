/**
 * The JSX runtime the Babel preset emits calls into.
 *
 * It only has to build elements; the React stand-in does the rest.
 */
const { Fragment, jsx } = require("./react-shim");

module.exports = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment };
