import glob from "glob";
import Mocha from "mocha";
import * as path from "node:path";

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    reporter: "spec",
    timeout: 10000,
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((c, e) => {
    glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
      if (err) {
        return e(err);
      }

      // Add files to the test suite
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      try {
        // Run the mocha test
        mocha.run(failures => {
          if (failures > 0) {
            console.error(`\n\n❌ ${failures} test(s) failed\n`);
            e(new Error(`${failures} tests failed.`));
          } else {
            console.log("\n✅ All tests passed!\n");
            c();
          }
        });
      } catch (err) {
        console.error("Test runner error:", err);
        e(err);
      }
    });
  });
}
