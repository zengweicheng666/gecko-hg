// |jit-test| debug
// Test eval-ing names in a topmost script frame

load(libdir + "asserts.js");

var g = newGlobal('new-compartment');
var dbg = new Debug(g);
var hits = 0;
dbg.hooks = {
    debuggerHandler: function (frame) {
        assertEq(frame.eval("a").return, 2);
        assertEq(frame.eval("c").return, 4);
        var exc = frame.eval("d").throw;
        assertEq(exc instanceof Debug.Object, true);
        assertEq(exc.prototype, frame.eval("ReferenceError.prototype").return);
        hits++;
    }
};
g.eval("function f(a, b) { var c = a + b; debugger; eval('debugger;'); }");
g.eval("f(2, 2);");
g.eval("var a = 2, b = 2, c = a + b; debugger;");
assertEq(hits, 3);
