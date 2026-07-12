import { injectVpcFetchers } from "../../platform/vpc-transport.js";

export interface FetcherLike {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface CpuModuleEnv {
  AUDIO_BEAT_SYNC_VPC?: FetcherLike;
  AUDIO_MASTER_VPC?: FetcherLike;
  VIDEO_FINISH_VPC?: FetcherLike;
}

export function cpuModuleEnvFromProcess(processEnv: NodeJS.ProcessEnv): CpuModuleEnv {
  const bag: Record<string, unknown> = {};
  injectVpcFetchers(bag, processEnv);
  return bag as CpuModuleEnv;
}
