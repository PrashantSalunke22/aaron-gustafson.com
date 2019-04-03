/* jshint -W097 */
"use strict";

const version = "v2:",

      // Stuff to load on install
      fallback_avatar = "/i/fallbacks/avatar.svg",
      fallback_image = "/i/fallbacks/image.svg",
      offline_image = "/i/fallbacks/offline.svg",
      offline_page = "/offline.html",
      preinstall = [
        // images
        "/favicon.png",
        fallback_avatar,
        fallback_image,
        offline_image,
        // CSS
        "/c/default.css",
        "/c/advanced.css",
        // JavaScript
        "/j/main.js",
        // Offline
        offline_page
      ],

      // caches
      sw_caches = {
        static: {
          name: `${version}static`
        },
        images: {
          name: `${version}images`,
          limit: 75
        },
        pages: {
          name: `${version}pages`,
          limit: 5
        },
        posts: {
          name: `${version}posts`,
          limit: 10,
          path: /\/notebook\//
        },
        other: {
          name: `${version}other`,
          limit: 50
        }
      },

      // Never cache
      ignore = [
        'p.typekit.net/p.gif',
        'www.google-analytics.com/r/collect',
        'ogg',
        'mp3',
        'mp4',
        'ogv',
        'webm',
        'chrome-extension'
      ],

      // How to decide what gets cached and
      // what might not be left out
      high_priority = [
        /aaron\-gustafson\.com/,
        /adaptivewebdesign\.info/
      ],

      avatars = /webmention\.io/,
      
      fetch_config = {
        images: {
          mode: 'no-cors'
        }
      };
self.addEventListener( "activate", event => {
  
  // console.log('WORKER: activate event in progress.');
  
  // clean up stale caches
  event.waitUntil(
    caches.keys()
      .then( keys => {
        return Promise.all(
          keys
            .filter( key => {
              return ! key.startsWith( version );
            })
            .map( key => {
              return caches.delete( key );
            })
        ); // end promise
      }) // end then
  ); // end event
});
addEventListener("message", messageEvent => {
  if (messageEvent.data == "clean up")
  {
    for ( let key in sw_caches )
    {
      if ( sw_caches[key].limit != undefined )
      {
        trimCache( sw_caches[key].name, sw_caches[key].limit );
      }
    }
  }
});

function trimCache( cache_name, limit )
{
  caches.open( cache_name )
    .then( cache => {
      cache.keys()
        .then( items => {
          if ( items.length > limit ) {
            cache.delete( items[0] )
              .then(
                trimCache( cache_name, limit)
              ); // end delete
          } // end if
        }); // end keys
    }); // end open
}
self.addEventListener( "fetch", event => {
  
  // console.log( "WORKER: fetch event in progress." );
  
  const request = event.request,
        url = request.url,
        save_data = request.headers.get("save-data");
  
  if ( request.method !== "GET" || shouldBeIgnored( url ) )
  {
    return;
  }
  
  // HTML
  if ( request.headers.get("Accept").includes("text/html") )
  {
  
    // notebook entries - cache first, then network (posts will be saved for offline individually), offline fallback
    if ( sw_caches.posts.path.test( url ))
    {
      event.respondWith(
        caches.match( request )
          .then( cached_result => {
            // cached first
            if ( cached_result )
            {
              // Update the cache in the background, but only if we’re not trying to save data
              if ( ! save_data )
              {
                event.waitUntil(
                  refreshCachedCopy( request, sw_caches.pages.name )
                );
              }
              return cached_result;
            }
            // fallback to network
            return fetch( request )
              // fallback to offline page
              .catch(
                respondWithOfflinePage
              );
          })
      );
    }

    // all other pages - check the cache first, then network, cache reponse, offline fallback
    else
    {
      event.respondWith(
        // check the cache first
        caches.match( request )
          .then( cached_result => {
            if ( cached_result )
            {
              // Update the cache in the background, but only if we’re not trying to save data
              if ( ! save_data )
              {
                event.waitUntil(
                  refreshCachedCopy( request, sw_caches.pages.name )
                );
              }
              return cached_result;
            }
            // fallback to network, but cache the result
            return fetch( request )
              .then( response => {
                const copy = response.clone();
                event.waitUntil(
                  saveToCache( "pages", request, copy )
                ); // end waitUntil
                return response;
              })
              // fallback to offline page
              .catch(
                respondWithOfflinePage
              );
          })
      );
    }
  }

  // images - cache first, then determine if we should request form the network & cache, fallbacks
  else if ( request.headers.get("Accept").includes("image") )
  {
    event.respondWith(
      // check the cache first
      caches.match( request )
        .then( cached_result => {
          if ( cached_result )
          {
            return cached_result;
          }

          // high priority imagery
          if ( isHighPriority( url ) )
          {
            return fetch( request, fetch_config.images )
              .then( response => {
                const copy = response.clone();
                event.waitUntil(
                  saveToCache( "images", request, copy )
                ); // end waitUntil
                return response;
              })
              .catch(
                respondWithOfflineImage
              );
          }
          // all others
          else
          {
            // save data?
            if ( save_data )
            {
              return respondFallbackImage( url );
            }

            // normal operation
            else
            {
              return fetch( request )
                // fallback to offline image
                .catch(function(){
                  return respondFallbackImage( url, offline_image );
                });
            }
          }
        })
    );
  }

  // everything else - cache first, then network
  else
  {
    event.respondWith(
      // check the cache first
      caches.match( request )
        .then( cached_result => {
          if ( cached_result )
          {
            return cached_result;
          }

          // save data?
          if ( save_data )
          {
            return new Response( "", {
              status: 408,
              statusText: "This request was ignored to save data."
            });
          }
          
          // normal operation
          else
          {
            return fetch( request )
              .then( response => {
                const copy = response.clone();
                event.waitUntil(
                  saveToCache( "other", request, copy )
                );
                return response;
              })
              // fallback to offline image
              .catch(function(){
                return new Response( "", {
                  status: 408,
                  statusText: "The server appears to be offline."
                });
              });
          }
        })
    );
  }

});
self.addEventListener( "install", function( event ){

  // console.log( "WORKER: install event in progress." );

  event.waitUntil(
    caches.open( sw_caches.static.name )
      .then(function( cache ){
        return cache.addAll( preinstall );
      })
  );

});

function saveToCache( cache, request, response )
{
  caches.open( sw_caches[cache].name )
    .then( cache => {
      return cache.put( request, response );
    });
}

function refreshCachedCopy( the_request, cache_name )
{
  fetch( the_request )
    .then( the_response => {
      caches.open( cache_name )
        .then( the_cache => {
          return the_cache.put( the_request, the_response );
        });
    });
}

function shouldBeIgnored( url )
{
  // console.log( 'WORKER: Checking ignore list', ignore );
  let i = ignore.length;
  while( i-- )
  {
    if ( url.indexOf( ignore[i] ) > -1 )
    {
      return true;
    }
  }
  return false;
}

function isHighPriority( url )
{
  let i = high_priority.length;
  while ( i-- )
  {
    if ( url.test( high_priority[i] ) )
    {
      return true;
    }
  }
  return false;
}

function respondWithOfflinePage()
{
  return caches.match( offline_page );
}

function respondWithFallbackImage( url, fallback = fallback_image )
{
  const image = avatars.test( url ) ? fallback_avatar : fallback;
  return caches.match( image );
}

function respondWithOfflineImage()
{
  return caches.match( offline_image );
}