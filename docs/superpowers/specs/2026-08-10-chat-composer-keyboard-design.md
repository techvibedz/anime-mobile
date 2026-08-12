# Chat Composer Keyboard Design

## Scope

Apply the same composer layout and keyboard behavior to the user chat and admin chat screens. Message loading, realtime subscriptions, sending, photo attachments, and closed-thread behavior remain unchanged.

## Layout And Colors

- Keep the 48px input, camera button, and send button aligned along the bottom of the composer.
- Use the existing periwinkle accent for the send button.
- Use the existing mint tokens for the camera icon, border, and soft background.
- Use the opaque elevated surface for the input so its text, placeholder, and boundary remain clear.
- Keep all existing accessibility labels, roles, disabled states, and touch targets.

## Keyboard Behavior

Continue using the existing `KeyboardAvoidingView`. Track keyboard visibility using React Native keyboard show and hide events.

When the keyboard is closed, the composer includes the device bottom safe-area inset plus its normal 8px spacing. When the keyboard is open, the safe-area inset is removed and only 8px remains, placing the composer directly above the keyboard. Closing the keyboard restores the original bottom position. Opening the keyboard also scrolls the message list to its end.

## Verification And Release

- Run the repository test command and distinguish any pre-existing failure from failures introduced by this change.
- Inspect the final diff for both chat screens.
- Publish the verified JavaScript update only to the `preview` OTA branch using the existing OTA script.
- Confirm the published update details from EAS output.
