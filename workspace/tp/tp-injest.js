exports.run = async function (args) {
    const parse = require('csv-parse')
    const fs = require('fs')

    const cassandra = require('cassandra-driver');
    const client = new cassandra.Client({
        contactPoints: ['cassandra'],
        localDataCenter: 'datacenter1'
    });


    /*
    On créé notre keyspace s'il n'existe pas
     */
    await client.execute("CREATE KEYSPACE IF NOT EXISTS ufcead WITH REPLICATION = { 'class' : 'NetworkTopologyStrategy', 'datacenter1' : 1 }");

    /*
    Création de la table principale
     */
    await client.execute(`
        CREATE TABLE IF NOT EXISTS ufcead.tweets (
            tweetid text,
            username text,
            text text,
            createdAt timestamp,
            primary key (tweetid)
        )
    `);
    /*
    Création de la table d'index pour la timeline user
     */
    await client.execute(`
        CREATE TABLE IF NOT EXISTS ufcead.user_timeline (
            username text,
            createdAt timestamp,
            tweetid text,
            primary key (username, createdAt)
        ) ;
    `);
    /*
    Création de la table d'index pour la timeline hashtag
     */
    await client.execute(`
        CREATE TABLE IF NOT EXISTS ufcead.htag_timeline (
            htag text,
            createdAt timestamp,
            tweetid text,
            primary key (htag, createdAt)
        ) ;
    `);

    const start = Date.now();
    let readCount = 0;

    let max = -1;
    if(args.length > 0) {
        max = parseInt(args[0])
        console.info("will read " + max + " records from weatherAUS.csv")
    } else {
        console.info("will read all records from FIFA.csv")
    }

    /*
    Ouverture d'un flux pour lire le fichier avec la librairie fs.
    Le flux est ensuite passé (methode pipe) à la librairie csv-parse qui implémente un mécanisme de lecture asynchrone
    du fichier.
     */
    let stream = fs.createReadStream('./workspace/fifa-2018-tweets/data-set/FIFA.csv');
    await stream
        .pipe(parse({
            delimiter: ',',
            skip_lines_with_error: true,
            columns: true
        }))
        .on('readable', async function(){
            /*
            Cette fonction est appelée lors que des lignes du fchier CSV sont prètes à être traitées
             */
            let row
            let lapStart = Date.now()
            while (row = this.read()) {
                /*
                Insertion de d'un échantillon
                 */
                try {
                    /*
                    Insertion dans la table principale
                     */
                    await client.execute(
                        'INSERT INTO ufcead.tweets (tweetid, username, text, createdAt) VALUES (?,?,?,?)',
                        [
                            row.ID,
                            row.Name,
                            row.Orig_Tweet,
                            Date.parse(row.Date)
                        ],
                        {prepare: true});
                    /*
                    Insertion dans la table d'index user, une insertion par tweet en fonction de son user
                     */

                    if(row.Name && row.Name != '') {
                        await client.execute(
                            'INSERT INTO ufcead.user_timeline (username, tweetid, createdAt) VALUES (?,?,?)',
                            [
                                row.Name,
                                row.ID,
                                Date.parse(row.Date)
                            ],
                            {prepare: true});
                    }

                    /*
                    Insertion dans la table d'index par tag, autant d'insertion que de tags portés par le tweet
                     */
                    let tags = row.Hashtags ? row.Hashtags.split(',') : [];
                    for (var i = 0; i < tags.length; i++) {
                        await client.execute(
                            'INSERT INTO ufcead.htag_timeline (htag, tweetid, createdAt) VALUES (?,?,?)',
                            [
                                tags[i],
                                row.ID,
                                Date.parse(row.Date)
                            ],
                            {prepare: true});
                    }
                } catch (e) {
                    console.error("error indexing document : ", row)
                    console.error("error was : ", e)
                }

                readCount++
                if(readCount % 5000 == 0) {
                    const elapsed = (Date.now() - lapStart) / 1000
                    lapStart = Date.now()
                    console.info(readCount + " rows read, last 5000 in " + elapsed + "s.")
                }
                if(readCount == max) {
                    console.info("max read reached")
                    this.end()
                    return
                }
            }
        })
        .on('end', function () {
            const elapsed = (Date.now() - start) / 1000;
            console.info("Read " + readCount + " rows data-set in " + elapsed + "s.")
        })

}