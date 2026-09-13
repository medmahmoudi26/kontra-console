/**
 * SECRETS — its own surface as of v2, and it was two sections of Settings.
 *
 * THE PROMOTION IS NOT COSMETIC. What lives here is a write-only store with a binding lifecycle
 * (`bound`, `unbound`, `revoked`, `undeclared`) and a read AUDIT. That is a thing an operator opens
 * DURING a run — "which slot is this actor blocked on", "who read the token at 16:42" — not a thing
 * configured once and forgotten. Filed under Settings it read as configuration, which is the one
 * thing it is not.
 *
 * NOTHING HERE IS NEW CODE. `SecretsSection` and `SlotBindings` already existed, already carry the
 * lifecycle, and are already covered by render tests whose sharpest assertion is a NEGATIVE one:
 * no credential may appear in the markup, because no route would hand one to a browser. This file
 * moves them and changes neither.
 *
 * `SettingsSurface` is reused rather than replaced — the sectioned layout is what both surfaces
 * want, and a second one would be a second answer to "what does a settings-shaped page look like".
 */

import { SettingsSurface, type SettingsSection } from './SettingsPage';
import SecretsSection from './SecretsSection';
import SlotBindingsSection from './SlotBindings';

export default function SecretsPage(): JSX.Element {
  const sections: SettingsSection[] = [
    {
      id: 'secrets',
      title: 'Secrets',
      blurb:
        'Named, versioned references — never inlined. Workflow code names a secret and the worker resolves it at the last hop; an actor fetches its own at load, authenticated as itself. A value is never handed through a Batch, an activity argument or a workflow argument, because workflow history keeps all three in the clear.',
      state: 'ready',
      body: <SecretsSection />,
    },
    {
      id: 'bindings',
      title: 'Credential bindings',
      blurb:
        'Actors declare slots; you bind them. A third-party actor’s author cannot know your secret names, so it declares `api_key` and you point that at whichever of your secrets it should be — and it never learns which. What an actor will ask for is listed before it runs, a new slot in a new version reads as a change, and every read and every refusal is in the ledger at the bottom.',
      state: 'ready',
      body: <SlotBindingsSection />,
    },
  ];

  return <SettingsSurface sections={sections} />;
}
