export function getChatCSS(brandColor: string): string {
  return /* css */ `
  :host {
    all: initial;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #1A1A2E;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* Launcher button */
  .ws-chat-launcher {
    position: fixed;
    bottom: 20px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: ${brandColor};
    color: #FFFFFF;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
    transition: transform 0.2s ease;
    z-index: 2147483645;
  }

  .ws-chat-launcher:hover {
    transform: scale(1.05);
  }

  .ws-chat-launcher--right {
    right: 20px;
  }

  .ws-chat-launcher--left {
    left: 20px;
  }

  .ws-chat-launcher svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Chat window */
  .ws-chat-window {
    position: fixed;
    bottom: 88px;
    width: 380px;
    max-width: calc(100vw - 32px);
    height: 520px;
    max-height: calc(100vh - 120px);
    background: #FFFFFF;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 2147483646;
    opacity: 0;
    transform: translateY(16px) scale(0.96);
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: none;
  }

  .ws-chat-window--open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .ws-chat-window--right {
    right: 20px;
  }

  .ws-chat-window--left {
    left: 20px;
  }

  /* Header */
  .ws-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: ${brandColor};
    color: #FFFFFF;
    flex-shrink: 0;
  }

  .ws-chat-header-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
  }

  .ws-chat-header-subtitle {
    font-size: 12px;
    opacity: 0.8;
    margin: 2px 0 0;
  }

  .ws-chat-close {
    background: none;
    border: none;
    color: #FFFFFF;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    opacity: 0.8;
    transition: opacity 0.2s ease;
  }

  .ws-chat-close:hover {
    opacity: 1;
  }

  .ws-chat-close svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Pre-chat form */
  .ws-chat-prechat {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    justify-content: center;
  }

  .ws-chat-prechat-text {
    font-size: 15px;
    color: #6B7280;
    margin: 0 0 4px;
  }

  .ws-chat-prechat-input {
    display: block;
    width: 100%;
    padding: 10px 12px;
    font-size: 15px;
    font-family: inherit;
    color: #1A1A2E;
    background: #FFFFFF;
    border: 1px solid #E8EAED;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .ws-chat-prechat-input:focus {
    border-color: ${brandColor};
    box-shadow: 0 0 0 3px ${brandColor}1a;
  }

  .ws-chat-prechat-input::placeholder {
    color: #9CA3AF;
  }

  .ws-chat-prechat-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 10px 20px;
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
    color: #FFFFFF;
    background: ${brandColor};
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: opacity 0.2s ease;
    margin-top: 4px;
  }

  .ws-chat-prechat-submit:hover {
    opacity: 0.9;
  }

  .ws-chat-prechat-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Messages area */
  .ws-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ws-chat-messages::-webkit-scrollbar {
    width: 4px;
  }

  .ws-chat-messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .ws-chat-messages::-webkit-scrollbar-thumb {
    background: #E8EAED;
    border-radius: 2px;
  }

  /* Message bubbles */
  .ws-chat-msg {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 14px;
    line-height: 1.45;
    word-break: break-word;
    position: relative;
  }

  .ws-chat-msg--inbound {
    align-self: flex-start;
    background: #F3F4F6;
    color: #1A1A2E;
    border-bottom-left-radius: 4px;
  }

  .ws-chat-msg--outbound {
    align-self: flex-end;
    background: ${brandColor};
    color: #FFFFFF;
    border-bottom-right-radius: 4px;
  }

  .ws-chat-msg-time {
    font-size: 11px;
    opacity: 0.6;
    margin-top: 4px;
    display: block;
  }

  .ws-chat-msg--outbound .ws-chat-msg-time {
    text-align: right;
  }

  .ws-chat-msg-sender {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 2px;
  }

  /* Welcome message */
  .ws-chat-welcome {
    text-align: center;
    padding: 16px;
    color: #6B7280;
    font-size: 14px;
  }

  /* Composer */
  .ws-chat-composer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #E8EAED;
    background: #FFFFFF;
    flex-shrink: 0;
  }

  .ws-chat-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #E8EAED;
    border-radius: 20px;
    font-size: 14px;
    font-family: inherit;
    color: #1A1A2E;
    outline: none;
    resize: none;
    max-height: 80px;
    min-height: 36px;
    line-height: 1.4;
    transition: border-color 0.2s ease;
  }

  .ws-chat-input:focus {
    border-color: ${brandColor};
  }

  .ws-chat-input::placeholder {
    color: #9CA3AF;
  }

  .ws-chat-send {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: ${brandColor};
    color: #FFFFFF;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: opacity 0.2s ease;
  }

  .ws-chat-send:hover {
    opacity: 0.9;
  }

  .ws-chat-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ws-chat-send svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Powered by */
  .ws-chat-powered {
    text-align: center;
    padding: 6px;
    font-size: 10px;
    color: #9CA3AF;
    border-top: 1px solid #F0F1F3;
    flex-shrink: 0;
  }

  /* Loading dots */
  .ws-chat-typing {
    display: flex;
    gap: 4px;
    padding: 10px 14px;
    align-self: flex-start;
    background: #F3F4F6;
    border-radius: 16px;
    border-bottom-left-radius: 4px;
  }

  .ws-chat-typing-dot {
    width: 6px;
    height: 6px;
    background: #9CA3AF;
    border-radius: 50%;
    animation: ws-chat-bounce 1.2s ease-in-out infinite;
  }

  .ws-chat-typing-dot:nth-child(2) {
    animation-delay: 0.15s;
  }

  .ws-chat-typing-dot:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes ws-chat-bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-4px); }
  }

  /* Error */
  .ws-chat-error {
    text-align: center;
    padding: 40px 20px;
    color: #EF4444;
    font-size: 14px;
  }

  /* Responsive */
  @media (max-width: 420px) {
    .ws-chat-window {
      width: calc(100vw - 16px);
      height: calc(100vh - 100px);
      bottom: 80px;
      right: 8px !important;
      left: 8px !important;
      border-radius: 12px;
    }
  }
`;
}
