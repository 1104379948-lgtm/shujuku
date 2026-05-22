// main-popup-api.ts
// API标签页（API & 连接）HTML生成

import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';

/**
 * 生成 API 标签页的 HTML 片段
 */
export function generateApiTabHTML(): string {
    return `
                <div id="acu-tab-api" class="acu-tab-content">
                     <div class="acu-card">
                        <h3>API设置</h3>
                        <div class="qrf_settings_block_radio">
                            <label>API模式:</label>
                            <div class="qrf_radio_group">
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-api-mode-custom" name="${SCRIPT_ID_PREFIX_ACU}-api-mode" value="custom" checked>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-mode-custom">自定义API</label>
                                <input type="radio" id="${SCRIPT_ID_PREFIX_ACU}-api-mode-tavern" name="${SCRIPT_ID_PREFIX_ACU}-api-mode" value="tavern">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-mode-tavern">使用酒馆连接预设</label>
                            </div>
                        </div>

                        <div id="${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-block" style="display: none; margin-top: 12px;">
                            <label for="${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-select">酒馆连接预设:</label>
                             <div class="input-group">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-tavern-api-profile-select"></select>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-refresh-tavern-api-profiles" title="刷新预设列表">刷新</button>
                            </div>
                            <small class="notes">选择一个你在酒馆主设置中已经配置好的连接预设。</small>
                        </div>

                        <div id="${SCRIPT_ID_PREFIX_ACU}-custom-api-settings-block" style="margin-top: 12px;">
                             <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-use-main-api-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-use-main-api-checkbox">使用主API (直接使用酒馆当前API和模型)</label>
                            </div>
                             <div class="checkbox-group">
                                <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-streaming-enabled-checkbox">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-streaming-enabled-checkbox">启用流式传输 (Streaming)</label>
                            </div>
                            <small class="notes">开启后，所有AI调用将使用流式传输，可减少首字节响应时间。默认关闭。</small>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-custom-api-fields">
                                <p class="notes" style="color: var(--acu-warning);"><b>安全提示:</b> API密钥将保存在浏览器本地存储中。</p>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-url">API基础URL:</label>
                                <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-api-url">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-key">API密钥(可选):</label>
                                <input type="password" id="${SCRIPT_ID_PREFIX_ACU}-api-key">
                                <div class="acu-grid" style="margin-top: 10px;">
                                    <div>
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-max-tokens">最大Tokens:</label>
                                        <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-max-tokens" min="1" step="1" placeholder="120000">
                                    </div>
                                    <div>
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-temperature">温度:</label>
                                        <input type="number" id="${SCRIPT_ID_PREFIX_ACU}-temperature" min="0" max="2" step="0.05" placeholder="0.9">
                                    </div>
                                </div>
                                <div class="button-group" style="margin-top: 10px;">
                                    <button id="${SCRIPT_ID_PREFIX_ACU}-load-models">加载模型列表</button>
                                </div>
                                <div class="acu-divider-dashed" style="margin: 14px 0 12px 0;"></div>
                                <label class="acu-label">附加参数</label>
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-extra-body-params">包括主体参数</label>
                                <textarea id="${SCRIPT_ID_PREFIX_ACU}-api-extra-body-params" rows="6" class="text_pole" placeholder="聊天完成请求主体中要包含的参数（JSON 对象或简单 YAML）&#10;&#10;示例：&#10;top_k: 20&#10;repetition_penalty: 1.1"></textarea>
                                <small class="notes">会合并进独立自定义 API 请求体；messages/model/reverse_proxy/custom_url 等关键字段会被保护，避免误覆盖基础请求。</small>

                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-excluded-body-params" style="margin-top: 10px;">排除主体参数</label>
                                <textarea id="${SCRIPT_ID_PREFIX_ACU}-api-excluded-body-params" rows="5" class="text_pole" placeholder="要从聊天完成请求主体中排除的参数（JSON 数组或每行一个字段）&#10;&#10;示例：&#10;- frequency_penalty&#10;- presence_penalty"></textarea>
                                <small class="notes">在附加参数和思维参数合并后执行，可用于移除某些服务不接受的字段，例如 reasoning_effort 或 thinking。</small>

                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-extra-headers" style="margin-top: 10px;">包含请求标头</label>
                                <textarea id="${SCRIPT_ID_PREFIX_ACU}-api-extra-headers" rows="5" class="text_pole" placeholder="聊天完成请求的附加上游请求头（JSON 对象或简单 YAML）&#10;&#10;示例：&#10;CustomHeader: 自定义值&#10;AnotherHeader: 自定义值"></textarea>
                                <small class="notes">这些标头会并入 custom_include_headers 转发给自定义上游 API，不会写入插件调用酒馆后端的 fetch headers。</small>

                                <div class="acu-grid" style="margin-top: 10px;">
                                    <div>
                                        <div class="checkbox-group">
                                            <input type="checkbox" id="${SCRIPT_ID_PREFIX_ACU}-api-thinking-enabled">
                                            <label for="${SCRIPT_ID_PREFIX_ACU}-api-thinking-enabled">启用思维模式参数</label>
                                        </div>
                                        <small class="notes">开启后发送 <code>thinking: { type: 'enabled' }</code>。</small>
                                    </div>
                                    <div>
                                        <label for="${SCRIPT_ID_PREFIX_ACU}-api-thinking-effort">思维强度</label>
                                        <select id="${SCRIPT_ID_PREFIX_ACU}-api-thinking-effort" class="text_pole">
                                            <option value="none">不启用</option>
                                            <option value="high">high</option>
                                            <option value="max">max</option>
                                        </select>
                                        <small class="notes">默认不启用；选择 high/max 并开启思维模式时写入 <code>reasoning_effort</code>。兼容规则：low/medium 可用 high 替代，xhigh 可用 max 替代。</small>
                                    </div>
                                </div>

                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-model-input" style="margin-top: 10px;">模型名称 (手动输入):</label>
                                <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-api-model-input" class="text_pole" placeholder="输入模型名称或从下方选择">
                                <label for="${SCRIPT_ID_PREFIX_ACU}-api-model-select" style="margin-top: 8px;">或从列表选择:</label>
                                <select id="${SCRIPT_ID_PREFIX_ACU}-api-model-select" class="text_pole">
                                    <option value="">-- 请先加载模型列表 --</option>
                                </select>
                            </div>
                            <div id="${SCRIPT_ID_PREFIX_ACU}-api-status" class="notes" style="margin-top:12px;">状态: 未配置</div>
                            <div class="button-group">
                                <button id="${SCRIPT_ID_PREFIX_ACU}-save-config" class="primary">保存API</button>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-clear-config">清除API</button>
                            </div>
                            
                            <!-- API预设管理 -->
                            <div class="acu-divider-dashed" style="margin: 16px 0 12px 0;"></div>
                            <label class="acu-label">API预设管理</label>
                            <div class="acu-row" style="margin-bottom: 8px;">
                                <input type="text" id="${SCRIPT_ID_PREFIX_ACU}-api-preset-name" placeholder="预设名称" style="flex: 1;">
                                <button id="${SCRIPT_ID_PREFIX_ACU}-save-api-preset" class="primary">保存为预设</button>
                            </div>
                            <div class="acu-row">
                                <select id="${SCRIPT_ID_PREFIX_ACU}-api-preset-select" style="flex: 1;">
                                    <option value="">-- 选择预设 --</option>
                                </select>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-load-api-preset">加载</button>
                                <button id="${SCRIPT_ID_PREFIX_ACU}-delete-api-preset" style="background: var(--acu-danger); color: white; border-color: var(--acu-danger);">删除</button>
                            </div>
                            <small class="notes">保存当前API配置为预设，可在填表和剧情推进中分别选用。</small>
                        </div>
                     </div>
                 </div>`;
}
