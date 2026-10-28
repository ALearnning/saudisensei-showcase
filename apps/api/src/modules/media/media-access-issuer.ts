import {
  MediaAccessError, mediaCapabilityDeadline, type MediaAccessFacts, type MediaAudience,
} from "./media-access-policy.js";
import type {
  MediaAccessMode, MediaCapability, PrivateMediaSigner,
} from "./media-provider-ports.js";

export interface MediaAccessRepository {
  /**
   * Fresh authoritative facts, not a cached provider profile or caller DTO.
   * Future binding must use existing guards and consistent course-first DB reads.
   */
  readFresh(input: {
    actorRef: string; placementRef: string; audience: MediaAudience; mode: MediaAccessMode;
  }): Promise<MediaAccessFacts | undefined>;
}

/**
 * Isolated pilot coordinator. No controller, module registration or production
 * signer is mounted until live storage/provider gates pass.
 */
export class MediaAccessIssuer {
  constructor(
    private readonly repository: MediaAccessRepository,
    private readonly signer: PrivateMediaSigner,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async issue(input: {
    actorRef: string; placementRef: string; audience: MediaAudience; mode: MediaAccessMode;
  }): Promise<MediaCapability> {
    try {
      // Deliberately no cached permission or stored capability, including renewals.
      const facts = await this.repository.readFresh(input);
      if (!facts) throw new MediaAccessError();
      const expiresAt = mediaCapabilityDeadline(facts, input.mode, input.audience, this.clock());
      const capability = await this.signer.sign({ mode: input.mode, resource: facts.resource, expiresAt });
      const url = new URL(capability.url);
      if (url.protocol !== "https:" || url.username || url.password ||
          !this.signer.allowedDeliveryHosts.has(url.hostname) ||
          capability.revisionRef !== facts.asset.currentRevisionRef ||
          !Number.isSafeInteger(capability.expiresAt) ||
          capability.expiresAt > expiresAt || capability.expiresAt <= this.clock()) {
        throw new MediaAccessError();
      }
      return capability;
    } catch {
      // Never include raw provider/repository errors, URLs, keys or identifiers.
      throw new MediaAccessError();
    }
  }
}
