import { TruffleColors } from "@ganache/colors";
import yargs, { Options } from "yargs";
import {
  Base,
  Defaults,
  Definitions,
  YargsPrimitiveCliTypeStrings
} from "@ganache/options";
import { Command, Argv } from "./types";
import chalk from "chalk";
import { EOL } from "os";
import marked from "marked";
import TerminalRenderer from "marked-terminal";
import { cliDefaults, serverDefaults } from "@ganache/flavor";
import EthereumFlavor from "@ganache/ethereum";

marked.setOptions({
  renderer: new TerminalRenderer({
    codespan: chalk.hex(TruffleColors.porsche),
    // Disable `unescape` since doesn't work for everything (we just do it ourselves)
    unescape: false
  })
});

const wrapWidth = Math.min(120, yargs.terminalWidth());
const NEED_HELP = "Need more help? Reach out to the Truffle community at";
const COMMUNITY_LINK = "https://trfl.io/support";

function unescapeEntities(html: string) {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\*\#COLON\|\*/g, ":");
}
const highlight = (t: string) => unescapeEntities(marked.parseInline(t));
const center = (str: string) =>
  " ".repeat(Math.max(0, Math.floor((wrapWidth - str.length) / 2))) + str;

const addAliases = (args: yargs.Argv<{}>, aliases: string[], key: string) => {
  const options = { hidden: true, alias: key };
  return aliases.reduce((args, a) => args.option(a, options), args);
};

function addOption(
  state: any,
  category: string,
  group: string,
  option: string,
  optionObj: Definitions<Base.Config>[string],
  argv: yargs.Argv
) {
  if (optionObj.disableInCLI !== true) {
    const shortHand = [];
    const legacyAliases = [];

    let description = highlight(optionObj.cliDescription || "");
    if (optionObj.cliAliases) {
      optionObj.cliAliases.forEach(alias => {
        if (alias.length === 1) shortHand.push(alias);
        else legacyAliases.push(alias);
      });
      description = chalk`${description}${EOL}{dim deprecated aliases: ${legacyAliases
        .map(a => `--${a}`)
        .join(", ")}}`;
    }

    const generateDefaultDescription = () => {
      // default sometimes requires a config, so we supply one
      return (state[option] = optionObj.default
        ? optionObj.default(state).toString()
        : undefined);
    };
    const defaultDescription =
      "defaultDescription" in optionObj
        ? optionObj.defaultDescription
        : generateDefaultDescription();

    // we need to specify the type of each array so yargs properly casts
    // the types held within each array
    const { cliType } = optionObj;
    const array = cliType && cliType.startsWith("array:"); // e.g. array:string or array:number
    const type = (
      array
        ? cliType.slice(6) // remove the "array:" part
        : cliType
    ) as YargsPrimitiveCliTypeStrings;

    const options: Options = {
      group,
      description,
      alias: shortHand,
      defaultDescription,
      array,
      type,
      choices: optionObj.cliChoices,
      coerce: optionObj.cliCoerce,
      implies: optionObj.implies
    };

    const key = `${category}.${option}`;

    // First, create *hidden* deprecated aliases...
    argv = addAliases(argv, legacyAliases, key);

    // and *then* create the main option, as options added later take precedence
    // example: `-d --wallet.seed 123` is invalid (mutally exclusive). If aliases are defined _after_
    // the main option definition the error message will be `Arguments deterministic and wallet.seed are mutually exclusive`
    // when it should be `Arguments wallet.deterministic and wallet.seed are mutually exclusive`
    argv = argv.option(key, options);
  }
}

function applyDefaults<D extends Defaults<any>>(
  defaults: D,
  args: yargs.Argv<{}>
) {
  for (const category in defaults) {
    type GroupType = `${Capitalize<typeof category>}:`;
    const group = `${category[0].toUpperCase()}${category.slice(
      1
    )}:` as GroupType;
    const categoryObj = defaults[
      category
    ] as unknown as Definitions<Base.Config>;
    const state = {};
    for (const option in categoryObj) {
      const optionObj = categoryObj[option];
      addOption(state, category, group, option, optionObj, args);
    }
  }
}

export const parseArgs = (version: string) => {
  const versionUsageOutputText = chalk`{hex("${
    TruffleColors.porsche
  }").bold ${center(version)}}`;
  let args = yargs
    // disable dot-notation because yargs just can't coerce args properly...
    // ...on purpose! https://github.com/yargs/yargs/issues/1021#issuecomment-352324693
    .parserConfiguration({ "dot-notation": false })
    .strict()
    .usage(versionUsageOutputText)
    .epilogue(
      versionUsageOutputText +
        EOL +
        EOL +
        chalk`{hex("${TruffleColors.porsche}").bold ${center(NEED_HELP)}}` +
        EOL +
        chalk`{hex("${TruffleColors.turquoise}") ${center(COMMUNITY_LINK)}}`
    );

  let flavor: string;
  let flavorDefaults: any;
  let command: Command;
  let defaultPort: number;
  const flavorArgIndex = process.argv.indexOf("--flavor", 2) + 1;
  if (flavorArgIndex > 2) {
    let flavor = process.argv[flavorArgIndex];
    command = ["$0"];
    args = args.option("flavor", {
      type: "string"
    });
    if (flavor !== "ethereum") {
      // filecoin used to be references by the name "filecoin", and not it's
      // package name
      if (flavor === "filecoin") flavor = "@ganache/filecoin";

      // load flavor plugin:
      const { default: FlavorInterface } = eval("require")(flavor);
      flavorDefaults = FlavorInterface.optionsConfig.defaults;
    } else {
      flavorDefaults = EthereumFlavor.optionsConfig.defaults;
    }
  } else {
    flavorDefaults = EthereumFlavor.optionsConfig.defaults;
    command = ["$0", "ethereum"];
  }

  // if (flavorDefaults.server && flavorDefaults.server.port) {
  //   defaultPort = flavorDefaults.server.port.default();
  // } else {
  //   defaultPort = 8545;
  // }

  args = args.command(
    command,
    chalk`Use the {bold ${flavor}} flavor of Ganache`,
    flavorArgs => {
      applyDefaults(cliDefaults, flavorArgs);

      applyDefaults(serverDefaults, flavorArgs);

      // flavorDefaults are applied after the default cli and server options
      // so that the flavor defaults can override them.
      if (flavorDefaults) {
        applyDefaults(flavorDefaults, flavorArgs);
      }
    }
  );

  args = args
    .showHelpOnFail(false, "Specify -? or --help for available options")
    .alias("help", "?")
    .wrap(wrapWidth)
    .version(version);

  const parsedArgs = args.argv;
  const finalArgs = {
    flavor: parsedArgs.flavor ? parsedArgs.flavor : "ethereum"
  } as Argv<any> & { flavor: string | "ethereum" };
  for (let key in parsedArgs) {
    // split on the first "."
    const [group, option] = key.split(/\.(.+)/);
    // only copy namespaced/group keys
    if (option) {
      if (!finalArgs[group]) {
        finalArgs[group] = {};
      }
      finalArgs[group][option] = parsedArgs[key];
    }
  }

  return finalArgs;
};
