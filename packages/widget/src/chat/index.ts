import type { CrmChatOptions } from './types.js';
import { ChatApiClient } from './api.js';
import { renderChatWidget, renderChatError } from './renderer.js';

async function init(options: CrmChatOptions): Promise<void> {
  const { widgetId, apiUrl } = options;

  // Create a container for the widget if not provided
  let el: HTMLElement;
  if (options.container) {
    el = typeof options.container === 'string'
      ? document.querySelector<HTMLElement>(options.container)!
      : options.container;
    if (!el) {
      throw new Error(`CrmChat: container "${options.container}" not found`);
    }
  } else {
    el = document.createElement('div');
    el.id = 'crm-chat-widget';
    document.body.appendChild(el);
  }

  const api = new ChatApiClient(apiUrl);

  try {
    const config = await api.fetchConfig(widgetId);
    renderChatWidget(el, config, api, widgetId);
  } catch (err) {
    renderChatError(el, err instanceof Error ? err.message : 'Failed to load chat widget');
  }
}

function autoInit(): void {
  const elements = document.querySelectorAll<HTMLElement>('[data-crm-chat]');
  for (const el of elements) {
    const widgetId = el.dataset.crmChat;
    const apiUrl = el.dataset.crmApiUrl;
    if (!widgetId || !apiUrl) continue;
    init({ widgetId, apiUrl, container: el });
  }

  // Also check for script-based initialization
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-crm-chat-widget]');
  for (const script of scripts) {
    const widgetId = script.dataset.crmChatWidget;
    const apiUrl = script.dataset.crmApiUrl;
    if (!widgetId || !apiUrl) continue;
    init({ widgetId, apiUrl });
  }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}

// Export for programmatic usage
export { init };
