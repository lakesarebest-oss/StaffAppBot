import express from "express";
import fetch from "node-fetch";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  PermissionsBitField
} from "discord.js";

const app = express();
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel]
});

// CONFIGURATION
const CHANNEL_ID = "1431924081502195763"; // Discord channel for staff applications
const SHEET_WEBHOOK = "https://script.google.com/macros/s/AKfycbzXEQ1nw3QIBhcgYhvab8T6WXr8YI5GNIiUetheIxpDEKfKMyfdkWcqbhd-j3c7l3d0/exec"; // Google Apps Script webhook

let botReady = false;
client.once("ready", () => {
  botReady = true;
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// 📩 Receive new applications from Google Sheets
app.post("/sendEmbed", async (req, res) => {
  try {
    if (!botReady) return res.status(503).json({ error: "Bot not ready" });

    const { title, color, fields, footer } = req.body;
    const channel = await client.channels.fetch(CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color || 0x3498db)
      .setTimestamp();

    if (footer?.text) embed.setFooter({ text: footer.text });
    for (const f of fields) {
      embed.addFields({
        name: f.name,
        value: f.value || "N/A",
        inline: f.inline || false
      });
    }

    const msg = await channel.send({ embeds: [embed] });
    await msg.react("✅");
    await msg.react("❌");

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ /sendEmbed error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🧠 Handle Approve / Deny reactions
client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const emoji = reaction.emoji.name;
    if (emoji !== "✅" && emoji !== "❌") return;

    const embed = reaction.message.embeds[0];
    if (!embed) return;

    // Extract applicant info
    const footerText = embed.footer?.text || "";
    const match = footerText.match(/Row\s+#(\d+)/);
    if (!match) return;
    const rowIndex = parseInt(match[1], 10);

    const status = emoji === "✅" ? "✅ Approved" : "❌ Denied";
    const discordUsername =
      embed.fields.find(f => f.name.includes("Discord Username"))?.value?.trim() || "N/A";

    // Check permissions
    const member = await reaction.message.guild.members.fetch(user.id);
    const allowedRoles = ["Commissioner", "Co-Commissioner"];
    const isStaff = member.roles.cache.some(r =>
      allowedRoles.some(ar => r.name.toLowerCase() === ar.toLowerCase())
    );
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!isStaff && !isAdmin) {
      await reaction.users.remove(user.id);
      await reaction.message.reply({
        content: `🚫 ${user}, you do not have permission to approve or deny.`,
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    // ✅ Update Google Sheet
    await fetch(SHEET_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowIndex, status })
    });

    // 📨 DM the applicant
    const guild = reaction.message.guild;
    const memberMatch = guild.members.cache.find(
      m =>
        m.user.tag.toLowerCase() === discordUsername.toLowerCase() ||
        m.user.username.toLowerCase() === discordUsername.toLowerCase()
    );

    if (memberMatch) {
      if (status === "✅ Approved") {
        await memberMatch.send({
          content: `🎉 **Congratulations!**\n\nYour staff application for **${guild.name}** has been **approved**.\nPlease wait for a staff manager to contact you for next steps.`
        }).catch(() => console.warn(`⚠️ Could not DM ${discordUsername}`));
      } else {
        await memberMatch.send({
          content: `❌ **Update:**\n\nYour staff application for **${guild.name}** has been **denied**.\nWe appreciate the time you took to apply — you can reapply in the future if you'd like.`
        }).catch(() => console.warn(`⚠️ Could not DM ${discordUsername}`));
      }
    } else {
      console.warn(`⚠️ Could not find Discord user for tag: ${discordUsername}`);
    }

    // Reply to confirm
    await reaction.message.reply({
      content: `Application **${status}** by ${user.username}`,
      allowedMentions: { repliedUser: false }
    });

    await reaction.users.remove(user.id).catch(() => {});
  } catch (err) {
    console.error("⚠️ Reaction handler error:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

client.login(process.env.BOT_TOKEN);
