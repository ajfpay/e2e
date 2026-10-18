/**
 * `@e2e-dev/ios`: an iOS engine that is an engine-protocol server written
 * in Swift, hosted by a UI test on the simulator. This module is its
 * client half: the manifest, the transport that starts the server, and the
 * checks only the host can make.
 */

import { ConfigurationError, connectEngine, type EngineHandle } from 'e2e/engine';
import { MANIFEST } from './manifest.ts';
import { iosTransport, type IosTransportOptions } from './transport.ts';

export type { IosTransportOptions as IosOptions } from './transport.ts';

/**
 * The iOS engine for a target. Drives one simulator (`udid`, else
 * `E2E_IOS_UDID`, else the one booted) and the target's `app.bundleId`.
 * Locators resolve on the host over each observation.
 */
export function ios(options: IosTransportOptions = {}): EngineHandle {
  const engine: EngineHandle = connectEngine({
    manifest: MANIFEST,
    transport: iosTransport(options),
    resolveLocators: true,
    fixtures: {
      device: (context) =>
        context.fixture(
          'device',
          {
            /** Swipes back from the screen's left edge. */
            back: () => engine.session!.back!(context.operation()),
          } satisfies IosDevice,
          { back: { kind: 'resource' } },
        ),
    },
    validateApp(app, { targetName }) {
      if (app.bundleId === undefined) {
        throw new ConfigurationError('INVALID_CONFIG', `target "${targetName}": the ios engine drives the app by its bundle id; set app.bundleId`);
      }
      if (app.url !== undefined || app.launchArguments !== undefined || app.permissions !== undefined) {
        throw new ConfigurationError('INVALID_CONFIG', `target "${targetName}": the ios engine does not apply app.url, app.launchArguments, or app.permissions yet; remove them`);
      }
    },
  });
  return engine;
}

/** The `device` fixture: the device controls a test reaches outside the screen. */
export interface IosDevice {
  back(): Promise<void>;
}
