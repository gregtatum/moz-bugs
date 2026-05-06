// @ts-check
import { fileURLToPath } from "url";

export async function main(argv = process.argv) {
  const [command] = argv.slice(2);

  try {
    switch (command) {
      case "hello": {
        console.log("hello");
        break;
      }
      default:
        console.error(`Unknown command: ${String(command)}`);
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
