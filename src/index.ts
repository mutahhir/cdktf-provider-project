/* eslint-disable @typescript-eslint/no-require-imports */
import assert = require("assert");
import { spawnSync } from "child_process";
import { pascalCase } from "change-case";
import { cdk, Task } from "projen";
import { AutoMerge } from "./auto-merge";
import { CdktfConfig } from "./cdktf-config";
import { PackageInfo } from "./package-info";
import { ProviderUpgrade } from "./provider-upgrade";

const version = require("../version.json").version;

function getMajorVersion(repository: string): number | undefined {
  console.log("Getting major version of", repository);
  try {
    const out = spawnSync(
      `gh release list -L=10000000 -R ${repository} | grep "v1." `,
      {
        shell: true,
      }
    );

    console.log(
      "fetched major version: ",
      out.status,
      out.stderr.toString(),
      out.stdout.toString()
    );

    // TODO: return value should be 1 if there is release yet
    if (out.status !== null) {
      // If we find no release starting with v1., we can assume that there are no releases
      // so we force the first one to be 1.x
      return out.status > 0 ? undefined : undefined;
    } else {
      // If there is no status, we assume no release was found and return 1
      return undefined;
    }
  } catch (e) {
    console.log("Error fetching major version", e);
    return undefined;
  }
}

export interface CdktfProviderProjectOptions extends cdk.JsiiProjectOptions {
  readonly terraformProvider: string;
  readonly cdktfVersion: string;
  readonly constructsVersion: string;
  readonly jsiiVersion?: string;
  readonly forceMajorVersion?: number;
}

const authorName = "HashiCorp";
const authorAddress = "https://hashicorp.com";
const namespace = "cdktf";
const githubNamespace = "hashicorp";

const getMavenName = (providerName: string): string => {
  return ["null", "random"].includes(providerName)
    ? `${providerName}_provider`
    : providerName.replace(/-/gi, "_");
};
export class CdktfProviderProject extends cdk.JsiiProject {
  constructor(options: CdktfProviderProjectOptions) {
    const {
      terraformProvider,
      workflowContainerImage = "hashicorp/jsii-terraform",
      cdktfVersion,
      constructsVersion,
      minNodeVersion,
      jsiiVersion,
    } = options;
    const [fqproviderName, providerVersion] = terraformProvider.split("@");
    const providerName = fqproviderName.split("/").pop();
    assert(providerName, `${terraformProvider} doesn't seem to be valid`);
    assert(
      !providerName.endsWith("-go"),
      "providerName may not end with '-go' as this can conflict with repos for go packages"
    );

    const nugetName = `HashiCorp.${pascalCase(
      namespace
    )}.Providers.${pascalCase(providerName)}`;
    const mavenName = `com.${githubNamespace}.cdktf.providers.${getMavenName(
      providerName
    )}`;

    const packageInfo: PackageInfo = {
      npm: {
        name: `@${namespace}/provider-${providerName}`,
      },
      python: {
        distName: `${namespace}-cdktf-provider-${providerName.replace(
          /-/gi,
          "_"
        )}`,
        module: `${namespace}_cdktf_provider_${providerName.replace(
          /-/gi,
          "_"
        )}`,
      },
      publishToNuget: {
        dotNetNamespace: nugetName,
        packageId: nugetName,
      },
      publishToMaven: {
        javaPackage: mavenName,
        mavenGroupId: `com.${githubNamespace}`,
        mavenArtifactId: `cdktf-provider-${providerName}`,
        mavenEndpoint: "https://hashicorp.oss.sonatype.org",
      },
      publishToGo: {
        moduleName: `github.com/hashicorp/cdktf-provider-${providerName}-go`,
        gitUserEmail: "github-team-tf-cdk@hashicorp.com",
        gitUserName: "CDK for Terraform Team",
      },
    };

    const repository = `${githubNamespace}/cdktf-provider-${providerName.replace(
      /-/g,
      ""
    )}`;

    super({
      ...options,
      workflowContainerImage,
      license: "MPL-2.0",
      releaseToNpm: true,
      minNodeVersion,
      devDeps: [`@cdktf/provider-project@^${version}`, "dot-prop@^5.2.0"],
      name: packageInfo.npm.name,
      description: `Prebuilt ${providerName} Provider for Terraform CDK (cdktf)`,
      keywords: ["cdktf", "terraform", "cdk", "provider", providerName],
      sampleCode: false,
      jest: false,
      authorAddress,
      authorName,
      authorOrganization: true,
      defaultReleaseBranch: "main",
      repository: `https://github.com/${repository}.git`,
      mergify: false,
      eslint: false,
      depsUpgradeOptions: {
        workflowOptions: {
          labels: ["automerge"],
        },
      },
      python: packageInfo.python,
      publishToNuget: packageInfo.publishToNuget,
      publishToMaven: packageInfo.publishToMaven,
      publishToGo: packageInfo.publishToGo,
      peerDependencyOptions: {
        pinnedDevDependency: false,
      },
      workflowGitIdentity: {
        name: "team-tf-cdk",
        email: "github-team-tf-cdk@hashicorp.com",
      },
      // sets major version to 1 for the first version but resets it for future versions to allow them to automatically increase to e.g. v2 if breaking changes occurred
      majorVersion: options.forceMajorVersion ?? getMajorVersion(repository),
    });

    // workaround because JsiiProject does not support setting packageName
    this.manifest.jsii.targets.go.packageName = providerName;

    // Golang needs more memory to build
    this.tasks.addEnvironment("NODE_OPTIONS", "--max-old-space-size=7168");

    // TODO: make an upstream PR to projen to not have to do this dance
    // set GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} during build so the gh CLI can be used
    const buildTask = (this as any).buildWorkflow!.buildTask as Task;
    (buildTask as any)._locked = false;
    buildTask.env("GH_TOKEN", "${{ secrets.GITHUB_TOKEN }}");
    (buildTask as any)._locked = true;

    this.tasks.addEnvironment("CHECKPOINT_DISABLE", "1");

    new CdktfConfig(this, {
      terraformProvider,
      providerName,
      providerVersion,
      cdktfVersion,
      constructsVersion,
      jsiiVersion,
      packageInfo,
    });
    new ProviderUpgrade(this);
    new AutoMerge(this);
  }
}
