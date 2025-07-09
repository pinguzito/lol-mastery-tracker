// Backend seguro com Node.js + Express para consultar a API da Riot
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const ACCOUNT_REGION = 'americas'; // Região para endpoints de conta
const GAME_REGION = 'br1';        // Região para dados do jogo
const DATA_DRAGON_VERSION = '15.13.1';

// Configuração aprimorada da API
const riotApiConfig = {
  headers: {
    'X-Riot-Token': RIOT_API_KEY,
    'User-Agent': 'LoLMasteryTracker/1.0 (sousadaniel2703@gmail.com)',
    'Accept-Charset': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Origin': 'http://localhost:3000'
  },
  timeout: 5000
};

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache para dados
let championCache = null;
let lastCacheUpdate = null;
let statusCache = null;
let lastStatusUpdate = 0;

// Delay entre requisições para evitar rate limit
const apiDelay = () => new Promise(resolve => setTimeout(resolve, 1200));

async function getChampionData() {
  const CACHE_TIME = 24 * 60 * 60 * 1000;

  if (championCache && Date.now() - lastCacheUpdate < CACHE_TIME) {
    return championCache;
  }

  try {
    const champRes = await axios.get(
      `http://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/data/pt_BR/champion.json`
    );
    championCache = champRes.data.data;
    lastCacheUpdate = Date.now();
    return championCache;
  } catch (err) {
    console.error('Erro ao buscar dados de campeões:', err.message);
    throw err;
  }
}

// Rota de status aprimorada
app.get('/status', async (req, res) => {
  try {
    if (Date.now() - lastStatusUpdate < 300000 && statusCache) {
      return res.json({ ...statusCache, cached: true });
    }

    const response = await axios.get(
      `https://${GAME_REGION}.api.riotgames.com/lol/status/v4/platform-data`,
      riotApiConfig
    );

    statusCache = {
      region: response.data.name,
      maintenance: response.data.maintenances.length > 0,
      incidents: response.data.incidents.map(i => 
        i.titles.find(t => t.locale === 'pt_BR')?.content || i.titles[0]?.content
      ),
      updatedAt: new Date()
    };
    lastStatusUpdate = Date.now();

    res.json({ ...statusCache, cached: false });
  } catch (error) {
    if (statusCache) {
      return res.json({ 
        ...statusCache, 
        cached: true, 
        warning: "Using cached data due to API failure" 
      });
    }
    res.status(500).json({ 
      error: 'Failed to check server status',
      details: error.response?.data || error.message 
    });
  }
});

// Rota principal otimizada
app.get('/maestrias/:nickname', async (req, res) => {
  try {
    // Validação do nickname
    const fullnick = decodeURIComponent(req.params.nickname);
    const [gameName, tagLine] = fullnick.split("#");
    
    if (!gameName || !tagLine) {
      return res.status(400).json({ 
        erro: 'Formato de nick inválido, use nick NICK#TAG' 
      });
    }

    // Debugging
    console.log(`[REQUEST] Buscando maestrias para: ${gameName}#${tagLine}`);
    console.log(`[KEY] Últimos 5 caracteres: ${RIOT_API_KEY?.slice(-5)}`);

    // 1. Buscar PUUID
    const puuidUrl = `https://${ACCOUNT_REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await axios.get(puuidUrl, riotApiConfig);
    await apiDelay();
    
    const puuid = accountRes.data.puuid;
    console.log(`[PUUID] ${puuid?.slice(0, 8)}...`);

    // 2. Buscar Summoner
    const summonerUrl = `https://${GAME_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    const summonerRes = await axios.get(summonerUrl, riotApiConfig);
    await apiDelay();

    // 3. Buscar Maestrias
    const masteryUrl = `https://${GAME_REGION}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`;
    const masteryRes = await axios.get(masteryUrl, riotApiConfig);
    const masteries = masteryRes.data.slice(0, 10);

    // 4. Mapear nomes de campeões
    const champData = await getChampionData();
    const idToName = Object.values(champData).reduce((acc, champ) => {
      acc[champ.key] = champ.name;
      return acc;
    }, {});

    // Resposta formatada
    const response = masteries.map(item => ({
      nome: idToName[item.championId.toString()] || `ID: ${item.championId}`,
      pontos: item.championPoints,
      nivel: item.championLevel
    }));

    res.json(response);

  } catch (err) {
    console.error('[ERRO COMPLETO]', {
      url: err.config?.url,
      status: err.response?.status,
      headers: err.config?.headers,
      data: err.response?.data,
      message: err.message
    });

    const statusCode = err.response?.status || 500;
    res.status(statusCode).json({
      erro: statusCode === 403 ? 'Acesso não autorizado' : 'Erro ao consultar API',
      detalhes: err.response?.data?.status?.message || err.message,
      solucao: [
        statusCode === 403 ? 'Verifique sua chave API' : 'Tente novamente mais tarde',
        'Confira o formato do nick (NICK#TAG)',
        statusCode === 429 ? 'Aguarde 1-2 minutos' : 'Verifique a conexão'
      ]
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});