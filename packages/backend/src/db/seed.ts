import path from 'node:path';
import { env } from '../config/env.js';
import { JsonStore } from './json-store.js';
import { hashPassword } from '../services/auth.js';

async function seed() {
  const store = new JsonStore(path.resolve(env.DATA_DIR));
  await store.init();

  console.log('Seeding database...');

  // --- Users ---
  const adminPasswordHash = await hashPassword('admin123');
  const managerPasswordHash = await hashPassword('manager123');
  const agentPasswordHash = await hashPassword('agent123');

  const adminUser = store.insert('users', {
    email: 'admin@crm.local',
    passwordHash: adminPasswordHash,
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    isActive: true,
    totpEnabled: false,
  });

  const managerUser = store.insert('users', {
    email: 'manager@crm.local',
    passwordHash: managerPasswordHash,
    firstName: 'Maria',
    lastName: 'Johnson',
    role: 'manager',
    isActive: true,
    totpEnabled: false,
  });

  const agent1 = store.insert('users', {
    email: 'agent1@crm.local',
    passwordHash: agentPasswordHash,
    firstName: 'Alex',
    lastName: 'Smith',
    role: 'agent',
    isActive: true,
    totpEnabled: false,
  });

  const agent2 = store.insert('users', {
    email: 'agent2@crm.local',
    passwordHash: agentPasswordHash,
    firstName: 'Sarah',
    lastName: 'Williams',
    role: 'agent',
    isActive: true,
    totpEnabled: false,
  });

  console.log(`  Created 4 users`);

  // --- Tags ---
  const tagVip = store.insert('tags', { name: 'VIP', color: '#EF4444' });
  const tagPartner = store.insert('tags', { name: 'Partner', color: '#3B82F6' });
  const tagLead = store.insert('tags', { name: 'Lead', color: '#10B981' });
  const tagHot = store.insert('tags', { name: 'Hot', color: '#F59E0B' });
  const tagCold = store.insert('tags', { name: 'Cold', color: '#6B7280' });

  console.log(`  Created 5 tags`);

  // --- Companies ---
  const compAcme = store.insert('companies', {
    name: 'Acme Corp',
    website: 'https://acme.example.com',
    phone: '+1-555-100-0001',
    industry: 'Technology',
    size: '51-200',
    address: '123 Main St, San Francisco, CA 94105',
    ownerId: agent1.id,
  });

  const compGlobal = store.insert('companies', {
    name: 'Global Industries',
    website: 'https://global-ind.example.com',
    phone: '+1-555-100-0002',
    industry: 'Manufacturing',
    size: '201-500',
    address: '456 Oak Ave, Chicago, IL 60601',
    ownerId: agent2.id,
  });

  const compTech = store.insert('companies', {
    name: 'TechStart Inc',
    website: 'https://techstart.example.com',
    phone: '+1-555-100-0003',
    industry: 'Software',
    size: '11-50',
    address: '789 Pine Rd, Austin, TX 73301',
    ownerId: agent1.id,
  });

  const compBright = store.insert('companies', {
    name: 'BrightPath Solutions',
    website: 'https://brightpath.example.com',
    phone: '+1-555-100-0004',
    industry: 'Consulting',
    size: '1-10',
    address: '321 Elm St, New York, NY 10001',
    ownerId: managerUser.id,
  });

  const compNova = store.insert('companies', {
    name: 'Nova Dynamics',
    website: 'https://novadyn.example.com',
    phone: '+1-555-100-0005',
    industry: 'Engineering',
    size: '501-1000',
    address: '654 Maple Dr, Seattle, WA 98101',
    ownerId: agent2.id,
  });

  console.log(`  Created 5 companies`);

  // --- Contacts ---
  const createdContacts = [
    store.insert('contacts', {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@acme.example.com',
      phone: '+1-555-200-0001',
      position: 'CTO',
      companyId: compAcme.id,
      ownerId: agent1.id,
      source: 'manual',
    }),
    store.insert('contacts', {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@acme.example.com',
      phone: '+1-555-200-0002',
      position: 'VP of Engineering',
      companyId: compAcme.id,
      ownerId: agent1.id,
      source: 'web_form',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'brand',
    }),
    store.insert('contacts', {
      firstName: 'Robert',
      lastName: 'Brown',
      email: 'r.brown@global-ind.example.com',
      phone: '+1-555-200-0003',
      position: 'Procurement Manager',
      companyId: compGlobal.id,
      ownerId: agent2.id,
      source: 'manual',
    }),
    store.insert('contacts', {
      firstName: 'Emily',
      lastName: 'Davis',
      email: 'emily.d@techstart.example.com',
      phone: '+1-555-200-0004',
      position: 'CEO',
      companyId: compTech.id,
      ownerId: agent1.id,
      source: 'email',
    }),
    store.insert('contacts', {
      firstName: 'Michael',
      lastName: 'Wilson',
      email: 'mwilson@brightpath.example.com',
      phone: '+1-555-200-0005',
      position: 'Managing Director',
      companyId: compBright.id,
      ownerId: managerUser.id,
      source: 'manual',
    }),
    store.insert('contacts', {
      firstName: 'Lisa',
      lastName: 'Taylor',
      email: 'lisa.t@novadyn.example.com',
      phone: '+1-555-200-0006',
      position: 'Head of Operations',
      companyId: compNova.id,
      ownerId: agent2.id,
      source: 'web_form',
      utmSource: 'linkedin',
      utmMedium: 'social',
      utmCampaign: 'outreach-q1',
    }),
    store.insert('contacts', {
      firstName: 'David',
      lastName: 'Martinez',
      email: 'david.m@gmail.com',
      phone: '+1-555-200-0007',
      position: 'Freelance Consultant',
      ownerId: agent1.id,
      source: 'api',
    }),
    store.insert('contacts', {
      firstName: 'Anna',
      lastName: 'Lee',
      email: 'anna.lee@global-ind.example.com',
      phone: '+1-555-200-0008',
      position: 'Finance Director',
      companyId: compGlobal.id,
      ownerId: agent2.id,
      source: 'csv_import',
    }),
  ];

  console.log(`  Created ${createdContacts.length} contacts`);

  // --- Contact Tags ---
  store.insert('contactTags', { contactId: createdContacts[0].id, tagId: tagVip.id });
  store.insert('contactTags', { contactId: createdContacts[0].id, tagId: tagPartner.id });
  store.insert('contactTags', { contactId: createdContacts[1].id, tagId: tagLead.id });
  store.insert('contactTags', { contactId: createdContacts[1].id, tagId: tagHot.id });
  store.insert('contactTags', { contactId: createdContacts[2].id, tagId: tagPartner.id });
  store.insert('contactTags', { contactId: createdContacts[3].id, tagId: tagHot.id });
  store.insert('contactTags', { contactId: createdContacts[4].id, tagId: tagVip.id });
  store.insert('contactTags', { contactId: createdContacts[5].id, tagId: tagLead.id });
  store.insert('contactTags', { contactId: createdContacts[6].id, tagId: tagCold.id });
  store.insert('contactTags', { contactId: createdContacts[7].id, tagId: tagPartner.id });

  console.log('  Assigned contact tags');

  // --- Pipelines ---
  const salesPipeline = store.insert('pipelines', {
    name: 'Sales Pipeline',
    description: 'Main sales process',
    isDefault: true,
    createdBy: adminUser.id,
  });

  const partnerPipeline = store.insert('pipelines', {
    name: 'Partner Onboarding',
    description: 'Pipeline for partner onboarding deals',
    isDefault: false,
    createdBy: managerUser.id,
  });

  const salesStages = [
    store.insert('pipelineStages', { pipelineId: salesPipeline.id, name: 'Lead In', color: '#6B7280', position: 0 }),
    store.insert('pipelineStages', { pipelineId: salesPipeline.id, name: 'Qualification', color: '#3B82F6', position: 1 }),
    store.insert('pipelineStages', { pipelineId: salesPipeline.id, name: 'Proposal Sent', color: '#8B5CF6', position: 2 }),
    store.insert('pipelineStages', { pipelineId: salesPipeline.id, name: 'Negotiation', color: '#F59E0B', position: 3 }),
    store.insert('pipelineStages', {
      pipelineId: salesPipeline.id,
      name: 'Closed Won',
      color: '#10B981',
      position: 4,
      isWinStage: true,
    }),
    store.insert('pipelineStages', {
      pipelineId: salesPipeline.id,
      name: 'Closed Lost',
      color: '#EF4444',
      position: 5,
      isLossStage: true,
    }),
  ];

  const partnerStages = [
    store.insert('pipelineStages', { pipelineId: partnerPipeline.id, name: 'Application', color: '#6B7280', position: 0 }),
    store.insert('pipelineStages', { pipelineId: partnerPipeline.id, name: 'Review', color: '#3B82F6', position: 1 }),
    store.insert('pipelineStages', { pipelineId: partnerPipeline.id, name: 'Agreement', color: '#8B5CF6', position: 2 }),
    store.insert('pipelineStages', {
      pipelineId: partnerPipeline.id,
      name: 'Active Partner',
      color: '#10B981',
      position: 3,
      isWinStage: true,
    }),
    store.insert('pipelineStages', {
      pipelineId: partnerPipeline.id,
      name: 'Rejected',
      color: '#EF4444',
      position: 4,
      isLossStage: true,
    }),
  ];

  console.log(`  Created 2 pipelines with stages`);

  // --- Deals ---
  const now = new Date();
  const inDays = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();

  const createdDeals = [
    store.insert('deals', {
      title: 'Acme Corp - Enterprise License',
      value: '75000.00',
      currency: 'USD',
      stage: 'negotiation',
      pipelineId: salesPipeline.id,
      pipelineStageId: salesStages[3].id,
      stageOrder: 0,
      contactId: createdContacts[0].id,
      companyId: compAcme.id,
      ownerId: agent1.id,
      expectedCloseDate: inDays(14),
      leadSource: 'referral',
    }),
    store.insert('deals', {
      title: 'Global Industries - Supply Contract',
      value: '120000.00',
      currency: 'USD',
      stage: 'proposal',
      pipelineId: salesPipeline.id,
      pipelineStageId: salesStages[2].id,
      stageOrder: 0,
      contactId: createdContacts[2].id,
      companyId: compGlobal.id,
      ownerId: agent2.id,
      expectedCloseDate: inDays(30),
      leadSource: 'website',
    }),
    store.insert('deals', {
      title: 'TechStart - Starter Plan',
      value: '5000.00',
      currency: 'USD',
      stage: 'qualification',
      pipelineId: salesPipeline.id,
      pipelineStageId: salesStages[1].id,
      stageOrder: 0,
      contactId: createdContacts[3].id,
      companyId: compTech.id,
      ownerId: agent1.id,
      expectedCloseDate: inDays(21),
      leadSource: 'organic',
    }),
    store.insert('deals', {
      title: 'BrightPath - Consulting Retainer',
      value: '36000.00',
      currency: 'USD',
      stage: 'won',
      pipelineId: salesPipeline.id,
      pipelineStageId: salesStages[4].id,
      stageOrder: 0,
      contactId: createdContacts[4].id,
      companyId: compBright.id,
      ownerId: managerUser.id,
      closedAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
      leadSource: 'referral',
    }),
    store.insert('deals', {
      title: 'Nova Dynamics - Integration Project',
      value: '95000.00',
      currency: 'USD',
      stage: 'new',
      pipelineId: salesPipeline.id,
      pipelineStageId: salesStages[0].id,
      stageOrder: 0,
      contactId: createdContacts[5].id,
      companyId: compNova.id,
      ownerId: agent2.id,
      expectedCloseDate: inDays(45),
      leadSource: 'linkedin',
      utmSource: 'linkedin',
      utmMedium: 'social',
    }),
    store.insert('deals', {
      title: 'Global Industries - Partner Program',
      value: '0.00',
      currency: 'USD',
      stage: 'new',
      pipelineId: partnerPipeline.id,
      pipelineStageId: partnerStages[0].id,
      stageOrder: 0,
      contactId: createdContacts[7].id,
      companyId: compGlobal.id,
      ownerId: agent2.id,
      expectedCloseDate: inDays(60),
    }),
  ];

  console.log(`  Created ${createdDeals.length} deals`);

  // --- Deal Tags ---
  store.insert('dealTags', { dealId: createdDeals[0].id, tagId: tagVip.id });
  store.insert('dealTags', { dealId: createdDeals[0].id, tagId: tagHot.id });
  store.insert('dealTags', { dealId: createdDeals[1].id, tagId: tagPartner.id });
  store.insert('dealTags', { dealId: createdDeals[3].id, tagId: tagVip.id });
  store.insert('dealTags', { dealId: createdDeals[4].id, tagId: tagLead.id });

  console.log('  Assigned deal tags');

  // --- Tasks ---
  store.insert('tasks', {
    title: 'Follow up with John Doe on license terms',
    description: 'Discuss pricing tiers and volume discounts for the enterprise license.',
    type: 'call',
    status: 'pending',
    priority: 'high',
    dueDate: inDays(2),
    contactId: createdContacts[0].id,
    dealId: createdDeals[0].id,
    assigneeId: agent1.id,
    createdById: managerUser.id,
  });

  store.insert('tasks', {
    title: 'Send proposal to Global Industries',
    description: 'Prepare and send the final supply contract proposal.',
    type: 'email',
    status: 'in_progress',
    priority: 'high',
    dueDate: inDays(1),
    contactId: createdContacts[2].id,
    dealId: createdDeals[1].id,
    assigneeId: agent2.id,
    createdById: managerUser.id,
  });

  store.insert('tasks', {
    title: 'Schedule demo for TechStart',
    description: 'Set up a product demo to move the deal to proposal stage.',
    type: 'meeting',
    status: 'pending',
    priority: 'medium',
    dueDate: inDays(5),
    contactId: createdContacts[3].id,
    dealId: createdDeals[2].id,
    assigneeId: agent1.id,
    createdById: agent1.id,
  });

  store.insert('tasks', {
    title: 'Onboarding call with BrightPath',
    description: 'Walk through the onboarding process for the consulting retainer.',
    type: 'call',
    status: 'pending',
    priority: 'medium',
    dueDate: inDays(3),
    contactId: createdContacts[4].id,
    dealId: createdDeals[3].id,
    assigneeId: managerUser.id,
    createdById: managerUser.id,
  });

  store.insert('tasks', {
    title: 'Research Nova Dynamics requirements',
    description: 'Gather integration requirements before first meeting.',
    type: 'other',
    status: 'completed',
    priority: 'low',
    completedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
    contactId: createdContacts[5].id,
    dealId: createdDeals[4].id,
    assigneeId: agent2.id,
    createdById: agent2.id,
  });

  console.log(`  Created 5 tasks`);

  // --- Activity Logs ---
  store.insert('activityLogs', {
    type: 'call',
    title: 'Initial discovery call',
    description: 'Discussed needs and budget with John Doe. Very interested in enterprise tier.',
    contactId: createdContacts[0].id,
    dealId: createdDeals[0].id,
    duration: 1800,
    occurredAt: new Date(now.getTime() - 7 * 86400000).toISOString(),
    createdById: agent1.id,
  });

  store.insert('activityLogs', {
    type: 'meeting',
    title: 'Product demo',
    description: 'Walked Robert through the product. Positive feedback on integrations.',
    contactId: createdContacts[2].id,
    dealId: createdDeals[1].id,
    duration: 3600,
    occurredAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
    createdById: agent2.id,
  });

  store.insert('activityLogs', {
    type: 'note',
    title: 'Competitor analysis',
    description: 'Emily mentioned they are evaluating two other solutions. Need to highlight our API.',
    contactId: createdContacts[3].id,
    dealId: createdDeals[2].id,
    occurredAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
    createdById: agent1.id,
  });

  store.insert('activityLogs', {
    type: 'call',
    title: 'Contract signing call',
    description: 'Michael signed the consulting retainer. Starting next month.',
    contactId: createdContacts[4].id,
    dealId: createdDeals[3].id,
    duration: 900,
    occurredAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
    createdById: managerUser.id,
  });

  console.log(`  Created 4 activity logs`);

  // --- Conversations & Messages ---
  const conv1 = store.insert('conversations', {
    contactId: createdContacts[0].id,
    assigneeId: agent1.id,
    channelType: 'email',
    status: 'open',
    subject: 'Re: Enterprise License Inquiry',
    lastMessageAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
  });

  const conv2 = store.insert('conversations', {
    contactId: createdContacts[5].id,
    assigneeId: agent2.id,
    channelType: 'web_chat',
    status: 'open',
    subject: 'Integration questions',
    lastMessageAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
  });

  store.insert('messages', {
    conversationId: conv1.id,
    direction: 'inbound',
    type: 'text',
    content: 'Hi, I wanted to follow up on the enterprise license pricing we discussed last week.',
    status: 'read',
    createdAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
  });

  store.insert('messages', {
    conversationId: conv1.id,
    senderId: agent1.id,
    direction: 'outbound',
    type: 'text',
    content:
      'Hello John! Thanks for reaching out. I have prepared a detailed breakdown of our enterprise tiers. Let me send that over.',
    status: 'delivered',
    createdAt: new Date(now.getTime() - 1.5 * 86400000).toISOString(),
  });

  store.insert('messages', {
    conversationId: conv1.id,
    direction: 'inbound',
    type: 'text',
    content: 'That would be great, looking forward to it!',
    status: 'read',
    createdAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
  });

  store.insert('messages', {
    conversationId: conv2.id,
    direction: 'inbound',
    type: 'text',
    content: 'Hello, we need to integrate your platform with our existing ERP. Is there an API?',
    status: 'read',
    createdAt: new Date(now.getTime() - 4 * 3600000).toISOString(),
  });

  store.insert('messages', {
    conversationId: conv2.id,
    senderId: agent2.id,
    direction: 'outbound',
    type: 'text',
    content:
      'Hi Lisa! Yes, we have a comprehensive REST API. I can share the documentation and set up a technical call.',
    status: 'delivered',
    createdAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
  });

  console.log(`  Created 2 conversations with 5 messages`);

  // Flush all data to JSON files
  await store.flush();

  console.log('\nSeed completed successfully!');
  console.log('\nTest accounts:');
  console.log('  admin@crm.local    / admin123   (admin)');
  console.log('  manager@crm.local  / manager123 (manager)');
  console.log('  agent1@crm.local   / agent123   (agent)');
  console.log('  agent2@crm.local   / agent123   (agent)');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
