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
  .crm-chat-launcher {
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
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 2147483645;
  }

  .crm-chat-launcher:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
  }

  .crm-chat-launcher--right {
    right: 20px;
  }

  .crm-chat-launcher--left {
    left: 20px;
  }

  .crm-chat-launcher svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Chat window */
  .crm-chat-window {
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

  .crm-chat-window--open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .crm-chat-window--right {
    right: 20px;
  }

  .crm-chat-window--left {
    left: 20px;
  }

  /* Header */
  .crm-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: ${brandColor};
    color: #FFFFFF;
    flex-shrink: 0;
  }

  .crm-chat-header-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
  }

  .crm-chat-header-subtitle {
    font-size: 12px;
    opacity: 0.8;
    margin: 2px 0 0;
  }

  .crm-chat-close {
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

  .crm-chat-close:hover {
    opacity: 1;
  }

  .crm-chat-close svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Pre-chat form */
  .crm-chat-prechat {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    justify-content: center;
  }

  .crm-chat-prechat-text {
    font-size: 15px;
    color: #6B7280;
    margin: 0 0 4px;
  }

  .crm-chat-prechat-input {
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

  .crm-chat-prechat-input:focus {
    border-color: ${brandColor};
    box-shadow: 0 0 0 3px ${brandColor}1a;
  }

  .crm-chat-prechat-input::placeholder {
    color: #9CA3AF;
  }

  .crm-chat-prechat-submit {
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

  .crm-chat-prechat-submit:hover {
    opacity: 0.9;
  }

  .crm-chat-prechat-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Messages area */
  .crm-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .crm-chat-messages::-webkit-scrollbar {
    width: 4px;
  }

  .crm-chat-messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .crm-chat-messages::-webkit-scrollbar-thumb {
    background: #E8EAED;
    border-radius: 2px;
  }

  /* Message bubbles */
  .crm-chat-msg {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 14px;
    line-height: 1.45;
    word-break: break-word;
    position: relative;
  }

  .crm-chat-msg--inbound {
    align-self: flex-start;
    background: #F3F4F6;
    color: #1A1A2E;
    border-bottom-left-radius: 4px;
  }

  .crm-chat-msg--outbound {
    align-self: flex-end;
    background: ${brandColor};
    color: #FFFFFF;
    border-bottom-right-radius: 4px;
  }

  .crm-chat-msg-time {
    font-size: 11px;
    opacity: 0.6;
    margin-top: 4px;
    display: block;
  }

  .crm-chat-msg--outbound .crm-chat-msg-time {
    text-align: right;
  }

  .crm-chat-msg-sender {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 2px;
  }

  /* Welcome message */
  .crm-chat-welcome {
    text-align: center;
    padding: 16px;
    color: #6B7280;
    font-size: 14px;
  }

  /* Composer */
  .crm-chat-composer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #E8EAED;
    background: #FFFFFF;
    flex-shrink: 0;
  }

  .crm-chat-input {
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

  .crm-chat-input:focus {
    border-color: ${brandColor};
  }

  .crm-chat-input::placeholder {
    color: #9CA3AF;
  }

  .crm-chat-send {
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

  .crm-chat-send:hover {
    opacity: 0.9;
  }

  .crm-chat-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .crm-chat-send svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Powered by */
  .crm-chat-powered {
    text-align: center;
    padding: 6px;
    font-size: 10px;
    color: #9CA3AF;
    border-top: 1px solid #F0F1F3;
    flex-shrink: 0;
  }

  /* Loading dots */
  .crm-chat-typing {
    display: flex;
    gap: 4px;
    padding: 10px 14px;
    align-self: flex-start;
    background: #F3F4F6;
    border-radius: 16px;
    border-bottom-left-radius: 4px;
  }

  .crm-chat-typing-dot {
    width: 6px;
    height: 6px;
    background: #9CA3AF;
    border-radius: 50%;
    animation: crm-chat-bounce 1.2s ease-in-out infinite;
  }

  .crm-chat-typing-dot:nth-child(2) {
    animation-delay: 0.15s;
  }

  .crm-chat-typing-dot:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes crm-chat-bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-4px); }
  }

  /* Error */
  .crm-chat-error {
    text-align: center;
    padding: 40px 20px;
    color: #EF4444;
    font-size: 14px;
  }

  /* Responsive */
  @media (max-width: 420px) {
    .crm-chat-window {
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
