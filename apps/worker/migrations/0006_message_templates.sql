-- Message Templates Migration
-- Adds default message template settings

-- Daily eligibility summary template
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('msg_template_eligibility', '🐸 *CHOG Eligibility — {{date}}*

📊 *Summary*
• Eligible: {{eligibleCount}}
• New: {{newCount}}
• Dropped: {{droppedCount}}

{{#if newlyEligible}}
✅ *Newly Eligible*
{{#each newlyEligible}}
• @{{handle}} — {{totalChog}} CHOG
{{/each}}
{{/if}}

{{#if droppedEligible}}
❌ *No Longer Eligible*
{{#each droppedEligible}}
• @{{handle}}
{{/each}}
{{/if}}

{{#if topEligible}}
🏆 *Top 10 Holders*
{{#each topEligible}}
{{medal}} @{{handle}} — {{totalChog}} CHOG
{{/each}}
{{/if}}');

-- Welcome message template  
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('msg_template_welcome', '🐸 Welcome @{{username}}! Your CHOG eligibility has been verified.');

-- Status response template
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('msg_template_status', '🐸 *CHOG Status for @{{username}}*

💰 Total CHOG: {{totalChog}}
{{statusEmoji}} Status: {{statusText}}

_Threshold: {{threshold}} CHOG_');
