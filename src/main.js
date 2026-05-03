import fs from 'fs';
import axios from 'axios';
import config from '../config.js';

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

function parseMonth(str) {
    const normalized = str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z]/g, '')
        .toLowerCase();
    const index = MONTHS.findIndex(m => m.startsWith(normalized));
    if (index === -1) {
        console.error(`FATAL: Unknown month "${str}" (normalized: "${normalized}")`);
        process.exit(1);
    }
    return index; // 0-based for Date constructor
}

function parseActivityDate(d) {
    if (!d) return null;
    const month = parseMonth(d.month);
    return new Date(d.year, month, parseInt(d.day), parseInt(d.hours), parseInt(d.minutes));
}

function getCompletedPostIds(dataDir) {
    const ids = new Set();
    if (!fs.existsSync(dataDir)) return ids;
    const entries = fs.readdirSync(dataDir);
    for (const entry of entries) {
        const entryPath = `${dataDir}/${entry}`;
        if (!fs.statSync(entryPath).isDirectory()) continue;
        const idFile = `${entryPath}/id.txt`;
        if (fs.existsSync(idFile)) {
            const postId = fs.readFileSync(idFile, 'utf-8').trim();
            if (postId) ids.add(postId);
        }
    }
    return ids;
}

function deleteInProgressDirs(dataDir) {
    if (!fs.existsSync(dataDir)) return;
    const entries = fs.readdirSync(dataDir);
    for (const entry of entries) {
        if (entry.startsWith('INPROGRESS ')) {
            const fullPath = `${dataDir}/${entry}`;
            console.log(`  Deleting incomplete: ${entry}`);
            fs.rmSync(fullPath, { recursive: true, force: true });
        }
    }
}

async function downloadFile(url, destPath, maxRetries = 20) {
    const inProgressPath = destPath + '.INPROGRESS';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`    URL: ${url}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}`);
            const res = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 0
            });
            const writer = fs.createWriteStream(inProgressPath);
            res.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                res.data.on('error', reject);
            });
            fs.renameSync(inProgressPath, destPath);
            return true;
        } catch (error) {
            console.log(`    ERROR downloading (attempt ${attempt}/${maxRetries}): ${error.message}`);
            if (fs.existsSync(inProgressPath)) {
                fs.unlinkSync(inProgressPath);
            }
            if (attempt < maxRetries) {
                const delay = Math.min(attempt * 200, 3000);
                console.log(`    Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    console.log(`    FAILED after ${maxRetries} attempts: ${url}`);
    return false;
}

(async () => {
    // Create an axios instance with cookie for API calls only
    const api = axios.create({
        headers: { 'Cookie': config.cookie }
    });

    const list = await api.get(config.base_url+'/spaces/list');
    console.log('Available spaces:');
    list.data.spaces.forEach((e) => console.log(`  id: ${e.id} (type: ${typeof e.id}) - name: ${e.name || e.title || 'N/A'} - enter_link: ${e.enter_link || 'N/A'}`));
    const journal = list.data.spaces.find((e) => e.id === config.id);
    if (!journal) {
        console.log('Veuillez fournir un id de séjour valide !');
        process.exit(0);
    }

    // Ensure data folder exists
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
    }

    // Resume: delete all INPROGRESS directories
    console.log('Cleaning up incomplete downloads...');
    deleteInProgressDirs('./data');

    // Collect already-completed post IDs
    const completedIds = getCompletedPostIds('./data');
    console.log(`Found ${completedIds.size} already-completed posts.`);

    const articles = await api.get(journal.enter_link+'/posts/list');
    const posts_count = journal.posts_count;
    const page_size = articles.data.page_size;
    for (let i = Math.ceil(posts_count/page_size); i >= 1; i--) {
        const page = await api.get(journal.enter_link+'/posts/list?page='+i);
        const pageData = page.data.data.reverse();

        for (let j = 0; j < pageData.length; j++) {
            const postId = String(pageData[j].id);

            // Skip already completed
            if (completedIds.has(postId)) {
                console.log(`  Skipping (already done): post ${postId} - ${pageData[j].title}`);
                continue;
            }

          try {

            // Get and parse title
            const title = pageData[j].title.replaceAll('/', '-').replaceAll(':', '').replaceAll('?', '');

            // Parse post date
            const rawDate = pageData[j].activity_date_detailed;
            const parsedDate = parseActivityDate(rawDate);

            // Build date prefix for folder name
            let datePrefix;
            if (parsedDate) {
                const y = parsedDate.getFullYear();
                const mo = String(parsedDate.getMonth() + 1).padStart(2, '0');
                const d = String(parsedDate.getDate()).padStart(2, '0');
                const h = String(parsedDate.getHours()).padStart(2, '0');
                const mi = String(parsedDate.getMinutes()).padStart(2, '0');
                datePrefix = `${y}-${mo}-${d} ${h}-${mi}`;
            } else {
                datePrefix = 'unknown';
            }

            const finalName = `${datePrefix} ${title}`;
            const inProgressName = `INPROGRESS ${finalName}`;
            const postDir = `./data/${inProgressName}`;

            console.log(`  Downloading: ${finalName} (post ${postId})`);
            console.log(`    Date raw: ${JSON.stringify(rawDate)} -> parsed: ${parsedDate ? parsedDate.toISOString() : 'null'}`);

            // Create in-progress folder
            if (!fs.existsSync(postDir)) {
                fs.mkdirSync(postDir);
            }

            // Write id.txt
            fs.writeFileSync(`${postDir}/id.txt`, postId);

            // Get and parse description
            const content = pageData[j].content.replaceAll('<br />', '').replaceAll('<br>', '');
            fs.writeFileSync(`${postDir}/message.txt`, content);

            // Set timestamp on message.txt
            if (parsedDate) {
                fs.utimesSync(`${postDir}/message.txt`, parsedDate, parsedDate);
            }

            // get post details
            console.log(`    Fetching post details for ${postId}...`);
            const currentData = await api.get(journal.enter_link+'/posts/with-details/'+pageData[j].id);
            const totalFiles = currentData.data.files ? currentData.data.files.length : 0;
            console.log(`    Got ${totalFiles} files`);

            // Determine zero-padding width
            const padWidth = String(totalFiles).length;
            const pad = (n) => String(n).padStart(padWidth, '0');

            let downloadFailed = false;
            let mediaCounter = 0;
            let youtubeCounter = 0;
            let miscCounter = 0;

            for (let k = 0; k < totalFiles; k++) {
                console.log(`    Processing file ${k+1}/${totalFiles}...`);
                const type = currentData.data.files[k].type;
                const ext = currentData.data.files[k].extension;

                let filePath;

                // YouTube links -> misc/youtube_N.txt
                if (currentData.data.files[k].src.includes('youtube.com')) {
                    youtubeCounter++;
                    const miscDir = `${postDir}/misc`;
                    if (!fs.existsSync(miscDir)) {
                        fs.mkdirSync(miscDir);
                    }
                    filePath = `${miscDir}/youtube_${pad(youtubeCounter)}.txt`;
                    const content = 'https:'+currentData.data.files[k].src;
                    fs.writeFileSync(filePath, content);
                } else if (type === 'image' || type === 'doc') {
                    // Images and videos go at toplevel
                    mediaCounter++;
                    filePath = `${postDir}/${pad(mediaCounter)}.${ext}`;

                    if (!await downloadFile(currentData.data.files[k].src, filePath)) {
                        downloadFailed = true;
                        continue;
                    }
                } else {
                    // Unrecognized type -> misc/
                    miscCounter++;
                    const miscDir = `${postDir}/misc`;
                    if (!fs.existsSync(miscDir)) {
                        fs.mkdirSync(miscDir);
                    }
                    filePath = `${miscDir}/${pad(miscCounter)}.${ext}`;

                    if (!await downloadFile(currentData.data.files[k].src, filePath)) {
                        downloadFailed = true;
                        continue;
                    }
                }

                if (!fs.existsSync(filePath)) {
                    continue;
                }

                // Set file timestamp
                if (parsedDate) {
                    fs.utimesSync(filePath, parsedDate, parsedDate);
                }

                // Download counter
                console.log(`    Download ${type} ${k+1}/${totalFiles} - ${ext}`);
            }

            if (downloadFailed) {
                console.log(`  INCOMPLETE (leaving as INPROGRESS): ${finalName}`);
            } else {
                // Rename to final name (remove destination if it exists from a prior partial run)
                const finalPath = `./data/${finalName}`;
                if (fs.existsSync(finalPath)) {
                    fs.rmSync(finalPath, { recursive: true, force: true });
                }
                fs.renameSync(postDir, finalPath);
                console.log(`  Done: ${finalName}`);
            }
          } catch (err) {
            console.error(`  ERROR processing post ${postId} (${pageData[j].title}): ${err.message}`);
          }
        }
    }
})();
